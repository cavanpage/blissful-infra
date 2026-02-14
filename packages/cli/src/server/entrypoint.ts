import { createApiServer } from "./api.js";

const port = parseInt(process.env.DASHBOARD_PORT || "3002", 10);
const workingDir = process.env.PROJECTS_DIR || "/projects";

const server = createApiServer(workingDir, port);
server.start().then(() => {
  console.log(`Dashboard API server running on port ${port}`);
  console.log(`Serving projects from: ${workingDir}`);
  if (process.env.DASHBOARD_DIST_DIR) {
    console.log(`Serving dashboard UI from: ${process.env.DASHBOARD_DIST_DIR}`);
  }
});
