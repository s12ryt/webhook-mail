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
  .then(() => initializeAdminAccount(storage, runtime.adminBootstrapUsername, runtime.adminBootstrapPassword))
  .then(() => {
    app.listen(runtime.port, () => {
      console.log(`docker-accept listening on http://localhost:${runtime.port} (storage: ${storage.mode})`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize docker-accept", error);
    process.exit(1);
  });
