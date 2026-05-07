import express, { type Request, type Response } from "express";

import { loadRuntimeConfig } from "./config.js";
import { registerRoutes, initializeAdminAccount } from "./routes.js";
import { createStorageAdapter, getStorageDisplayMode } from "./storage.js";

const app = express();
const runtime = loadRuntimeConfig(getStorageDisplayMode(process.env.MYSQL_URL ?? "", process.env.POSTGRES_URL ?? "", {
  url: process.env.GITHUB_URL ?? "",
  token: process.env.GITHUB_TOKEN ?? "",
  owner: process.env.GITHUB_OWNER ?? "",
  repo: process.env.GITHUB_REPO ?? "",
  branch: process.env.GITHUB_BRANCH ?? "main",
  path: process.env.GITHUB_PATH ?? "mail-events"
}));
const storage = createStorageAdapter(runtime.mysqlConnection, runtime.postgresConnection, runtime.githubStorageInput);

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));

registerRoutes(app, {
  storage,
  config: runtime
});

storage
  .init()
  .then(() => initializeAdminAccount(storage, runtime.adminBootstrapUsername, runtime.adminBootstrapPassword, runtime.adminBootstrapCreatedAt))
  .then((adminAccount) => {
    app.listen(runtime.port, () => {
      console.log(`docker-accept listening on http://localhost:${runtime.port} (storage: ${storage.mode})`);
      if (!process.env.ADMIN_INITIAL_PASSWORD && adminAccount.createdAt === runtime.adminBootstrapCreatedAt) {
        console.warn(`[security] ADMIN_INITIAL_PASSWORD was not set; generated one-time bootstrap password for ${runtime.adminBootstrapUsername}: ${runtime.adminBootstrapPassword}`);
        console.warn("[security] Set ADMIN_INITIAL_PASSWORD explicitly after first login or create a new admin credential in persistent storage.");
      }
    });
  })
  .catch((error) => {
    console.error("Failed to initialize docker-accept", error);
    process.exit(1);
  });
