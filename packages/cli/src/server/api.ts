import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { loadConfig, type ProjectConfig } from "../utils/config.js";
import { collectDockerLogs } from "../utils/collectors.js";
import {
  checkOllamaRunning,
  selectModel,
  listModels,
  chat,
  type ChatMessage,
} from "../utils/ollama.js";
import { collectContext, formatContextForPrompt } from "../utils/collectors.js";

const SYSTEM_PROMPT = `You are a helpful infrastructure assistant for the blissful-infra project. You help developers understand their application logs, diagnose issues, and suggest improvements.

When analyzing logs or issues:
1. Look for error messages, exceptions, and stack traces
2. Identify patterns in the logs (repeated errors, timing issues)
3. Correlate with recent code changes if commits are provided
4. Suggest specific, actionable fixes when possible

Keep responses concise and focused. Use markdown formatting for code blocks and lists.`;

interface Service {
  name: string;
  status: "running" | "stopped" | "starting";
  port?: number;
}

interface ProjectStatus {
  name: string;
  path: string;
  status: "running" | "stopped" | "unknown";
  type: string;
  backend?: string;
  frontend?: string;
  database?: string;
  services: Service[];
}

export function createApiServer(workingDir: string, port = 3002) {
  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://localhost:${port}`);

    try {
      // GET /api/projects - List all projects in working directory
      if (req.method === "GET" && url.pathname === "/api/projects") {
        const projects = await listProjects(workingDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ projects }));
        return;
      }

      // GET /api/projects/:name - Get specific project status
      const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (req.method === "GET" && projectMatch) {
        const projectName = projectMatch[1];
        const projectDir = path.join(workingDir, projectName);
        const status = await getProjectStatus(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(status));
        return;
      }

      // POST /api/projects - Create new project
      if (req.method === "POST" && url.pathname === "/api/projects") {
        const body = await readBody(req);
        const { name, type, backend, frontend, database } = JSON.parse(body);

        if (!name) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing project name" }));
          return;
        }

        const result = await createProject(workingDir, {
          name,
          type: type || "fullstack",
          backend: backend || "spring-boot",
          frontend: frontend || "react-vite",
          database,
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      // POST /api/projects/:name/up - Start project
      const upMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/up$/);
      if (req.method === "POST" && upMatch) {
        const projectName = upMatch[1];
        const projectDir = path.join(workingDir, projectName);
        await execa("docker", ["compose", "up", "-d"], {
          cwd: projectDir,
          stdio: "pipe",
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // POST /api/projects/:name/down - Stop project
      const downMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/down$/);
      if (req.method === "POST" && downMatch) {
        const projectName = downMatch[1];
        const projectDir = path.join(workingDir, projectName);
        await execa("docker", ["compose", "down"], {
          cwd: projectDir,
          stdio: "pipe",
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // GET /api/projects/:name/logs - Get project logs
      const logsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/logs$/);
      if (req.method === "GET" && logsMatch) {
        const projectName = logsMatch[1];
        const projectDir = path.join(workingDir, projectName);
        const logs = await collectDockerLogs(projectDir, { tail: 100 });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ logs }));
        return;
      }

      // POST /api/projects/:name/agent - Query agent for project
      const agentMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/agent$/);
      if (req.method === "POST" && agentMatch) {
        const projectName = agentMatch[1];
        const projectDir = path.join(workingDir, projectName);
        const body = await readBody(req);
        const { query, model: requestedModel } = JSON.parse(body);

        if (!query) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing query" }));
          return;
        }

        const response = await handleAgentQuery(projectDir, query, requestedModel);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ response }));
        return;
      }

      // DELETE /api/projects/:name - Delete project
      const deleteMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (req.method === "DELETE" && deleteMatch) {
        const projectName = deleteMatch[1];
        const projectDir = path.join(workingDir, projectName);

        // Stop containers first
        try {
          await execa("docker", ["compose", "down", "-v"], {
            cwd: projectDir,
            stdio: "pipe",
          });
        } catch {
          // Ignore errors if containers not running
        }

        // Remove directory
        await fs.rm(projectDir, { recursive: true, force: true });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // GET /api/templates - List available templates
      if (req.method === "GET" && url.pathname === "/api/templates") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          types: ["fullstack", "backend", "frontend"],
          backends: ["spring-boot", "fastapi", "express", "go-chi"],
          frontends: ["react-vite", "nextjs"],
          databases: ["none", "postgres", "redis", "postgres-redis"],
        }));
        return;
      }

      // GET /api/models - List available Ollama models
      if (req.method === "GET" && url.pathname === "/api/models") {
        const ollamaRunning = await checkOllamaRunning();
        if (!ollamaRunning) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            available: false,
            models: [],
            error: "Ollama is not running"
          }));
          return;
        }

        const models = await listModels();
        const recommended = await selectModel();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          available: true,
          models: models.map(m => ({
            name: m.name,
            size: m.size,
            modifiedAt: m.modifiedAt,
          })),
          recommended,
        }));
        return;
      }

      // 404 for unknown routes
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (error) {
      console.error("API error:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Internal server error",
        })
      );
    }
  });

  return {
    start: () => {
      return new Promise<void>((resolve) => {
        server.listen(port, () => {
          resolve();
        });
      });
    },
    stop: () => {
      return new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
    port,
  };
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      resolve(body);
    });
    req.on("error", reject);
  });
}

async function listProjects(workingDir: string): Promise<ProjectStatus[]> {
  const projects: ProjectStatus[] = [];

  try {
    const entries = await fs.readdir(workingDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const projectDir = path.join(workingDir, entry.name);
      const configPath = path.join(projectDir, "blissful-infra.yaml");

      try {
        await fs.access(configPath);
        const status = await getProjectStatus(projectDir);
        projects.push(status);
      } catch {
        // Not a blissful-infra project
      }
    }
  } catch {
    // Working directory doesn't exist or can't be read
  }

  return projects;
}

async function getProjectStatus(projectDir: string): Promise<ProjectStatus> {
  const config = await loadConfig(projectDir);

  if (!config) {
    return {
      name: path.basename(projectDir),
      path: projectDir,
      status: "unknown",
      type: "unknown",
      services: [],
    };
  }

  // Get container status
  const services: Service[] = [];
  let anyRunning = false;

  try {
    const { stdout } = await execa(
      "docker",
      ["compose", "ps", "--format", "json"],
      {
        cwd: projectDir,
        reject: false,
      }
    );

    // Parse JSON lines output
    const lines = stdout.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const container = JSON.parse(line);
        const name = container.Service || container.Name;
        const state = container.State?.toLowerCase() || "unknown";
        const isRunning = state === "running";

        if (isRunning) anyRunning = true;

        // Extract port from container
        let port: number | undefined;
        const ports = container.Publishers || [];
        if (ports.length > 0 && ports[0].PublishedPort) {
          port = ports[0].PublishedPort;
        }

        services.push({
          name,
          status: isRunning ? "running" : "stopped",
          port,
        });
      } catch {
        // Skip invalid JSON lines
      }
    }
  } catch {
    // Docker compose not running or error
  }

  // If no services from docker, infer from config
  if (services.length === 0) {
    const isFullstack = config.type === "fullstack";
    const isFrontendOnly = config.type === "frontend";

    if (!isFrontendOnly) {
      services.push({ name: "app", status: "stopped", port: 8080 });
      services.push({ name: "kafka", status: "stopped", port: 9092 });
    }

    if (isFullstack || isFrontendOnly) {
      services.push({ name: "frontend", status: "stopped", port: 3000 });
    }

    if (config.database === "postgres" || config.database === "postgres-redis") {
      services.push({ name: "postgres", status: "stopped", port: 5432 });
    }

    if (config.database === "redis" || config.database === "postgres-redis") {
      services.push({ name: "redis", status: "stopped", port: 6379 });
    }
  }

  return {
    name: config.name,
    path: projectDir,
    status: anyRunning ? "running" : "stopped",
    type: config.type || "backend",
    backend: config.backend,
    frontend: config.frontend,
    database: config.database,
    services,
  };
}

async function createProject(
  workingDir: string,
  options: {
    name: string;
    type: string;
    backend: string;
    frontend: string;
    database?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const { name, type, backend, frontend, database } = options;
  const projectDir = path.join(workingDir, name);

  // Check if project already exists
  try {
    await fs.access(projectDir);
    return { success: false, error: "Project already exists" };
  } catch {
    // Good, doesn't exist
  }

  // Run the create command
  try {
    const args = ["create", name, "--type", type];

    if (type !== "frontend") {
      args.push("--backend", backend);
    }
    if (type !== "backend") {
      args.push("--frontend", frontend);
    }
    if (database && database !== "none") {
      args.push("--database", database);
    }

    // Get the CLI path
    const cliPath = path.join(__dirname, "..", "index.js");

    await execa("node", [cliPath, ...args], {
      cwd: workingDir,
      stdio: "pipe",
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create project",
    };
  }
}

async function handleAgentQuery(
  projectDir: string,
  query: string,
  requestedModel?: string
): Promise<string> {
  // Check if Ollama is running
  const ollamaRunning = await checkOllamaRunning();
  if (!ollamaRunning) {
    return "Error: Ollama is not running. Please start Ollama with `ollama serve` and try again.";
  }

  // Use requested model or auto-select
  const model = requestedModel || (await selectModel());
  if (!model) {
    return "Error: No language models available in Ollama. Please pull a model with `ollama pull llama3.1:8b`.";
  }

  // Collect context
  const context = await collectContext(projectDir);
  const contextText = formatContextForPrompt(context);

  // Build messages
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${contextText}\n\n---\n\nQuestion: ${query}`,
    },
  ];

  // Get response
  const response = await chat(model, messages);
  return response;
}

const __dirname = path.dirname(new URL(import.meta.url).pathname);
