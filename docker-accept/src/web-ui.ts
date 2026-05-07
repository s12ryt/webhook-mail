import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type WebUiConfig = {
  rawBase: string;
  refreshSeconds: number;
  cacheDir: string;
};

export type WebUiPageData = Record<string, unknown> & {
  page: "login" | "dashboard";
};

type WebUiManifest = {
  version: string;
  entry: string;
  files: string[];
};

let lastCheckedAt = 0;
let lastVersion = "";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeFileName(file: string): string {
  return file.split("/").filter(Boolean).join(path.sep);
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "user-agent": "webhook-mail-web-ui-loader" } });
  if (!response.ok) {
    throw new Error(`Fetch ${url} failed: ${response.status}`);
  }
  return response.text();
}

async function refreshRemoteUi(config: WebUiConfig): Promise<void> {
  const now = Date.now();
  const refreshMs = Math.max(1, config.refreshSeconds) * 1000;
  if (now - lastCheckedAt < refreshMs) {
    return;
  }
  lastCheckedAt = now;

  await mkdir(config.cacheDir, { recursive: true });
  const base = config.rawBase.replace(/\/+$/g, "");
  const manifest = JSON.parse(await fetchText(`${base}/manifest.json`)) as WebUiManifest;
  const cachedManifest = await readOptional(path.join(config.cacheDir, "manifest.json"));
  const cachedVersion = cachedManifest ? (JSON.parse(cachedManifest) as Partial<WebUiManifest>).version : "";

  if (manifest.version === cachedVersion && manifest.version === lastVersion) {
    return;
  }

  for (const file of manifest.files) {
    const target = path.join(config.cacheDir, safeFileName(file));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await fetchText(`${base}/${file}`), "utf8");
  }

  await writeFile(path.join(config.cacheDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  lastVersion = manifest.version;
}

async function readCachedUi(config: WebUiConfig): Promise<{ html: string; css: string; js: string } | null> {
  const html = await readOptional(path.join(config.cacheDir, "index.html"));
  const css = await readOptional(path.join(config.cacheDir, "style.css"));
  const js = await readOptional(path.join(config.cacheDir, "app.js"));
  if (!html || !css || !js) {
    return null;
  }
  return { html, css, js };
}

async function readLocalUi(): Promise<{ html: string; css: string; js: string } | null> {
  const localRoot = path.resolve(process.cwd(), "web-ui");
  const html = await readOptional(path.join(localRoot, "index.html"));
  const css = await readOptional(path.join(localRoot, "style.css"));
  const js = await readOptional(path.join(localRoot, "app.js"));
  if (!html || !css || !js) {
    return null;
  }
  return { html, css, js };
}

export async function renderWebUiPage(config: WebUiConfig, title: string, data: WebUiPageData, fallback: () => string): Promise<string> {
  try {
    await refreshRemoteUi(config);
  } catch (error) {
    console.warn("web-ui remote refresh failed; using cached/local/fallback UI", error);
  }

  const ui = (await readCachedUi(config)) ?? (await readLocalUi());
  if (!ui) {
    return fallback();
  }

  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  return ui.html
    .replaceAll("{{TITLE}}", escapeHtml(title))
    .replace("{{STYLE_CSS}}", ui.css)
    .replace("{{APP_DATA_JSON}}", json)
    .replace("{{APP_JS}}", ui.js);
}
