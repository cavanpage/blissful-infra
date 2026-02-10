import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { loadConfig } from "../utils/config.js";
import { toExecError } from "../utils/errors.js";
import {
  collectDockerLogs,
  collectContext,
  formatContextForPrompt,
} from "../utils/collectors.js";
import {
  checkOllamaRunning,
  selectModel,
  listModels,
  chat,
  type ChatMessage,
} from "../utils/ollama.js";
import {
  saveMetrics,
  loadMetrics,
  getMetricsSummary,
  exportMetricsToJson,
  exportMetricsToCsv,
  getStorageInfo,
  clearMetrics,
  type ContainerMetricsData,
  type HttpMetricsData,
} from "../utils/metrics-storage.js";
import {
  checkAlerts,
  loadAlertsConfig,
  saveAlertsConfig,
  getActiveAlerts,
  getAlertHistory,
  addThreshold,
  updateThreshold,
  deleteThreshold,
  acknowledgeAlerts,
  initializeAlerts,
  type AlertThreshold,
  type MetricsSnapshot,
} from "../utils/alerts.js";
import {
  persistLogs,
  searchLogs,
  loadLogConfig,
  saveLogConfig,
  getLogStorageStats,
  forceRotate,
  clearLogs,
  type LogRetentionConfig,
} from "../utils/log-storage.js";

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

interface ContainerMetrics {
  name: string;
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  networkRx: number;
  networkTx: number;
}

interface ProjectMetrics {
  containers: ContainerMetrics[];
  httpMetrics?: HttpMetrics;
  timestamp: number;
}

interface HttpMetrics {
  totalRequests: number;
  requestsPerSecond: number;
  avgResponseTime: number;
  // Latency percentiles (in milliseconds)
  p50Latency?: number;
  p95Latency?: number;
  p99Latency?: number;
  // Error metrics
  errorCount?: number;
  errorRate?: number;
  // Status code breakdown
  status2xx?: number;
  status4xx?: number;
  status5xx?: number;
}

interface ServiceHealth {
  name: string;
  status: "healthy" | "unhealthy" | "unknown";
  responseTimeMs?: number;
  lastChecked: number;
  details?: string;
}

interface HealthResponse {
  services: ServiceHealth[];
  timestamp: number;
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

        // Use the CLI's up command which generates docker-compose.yaml
        const cliPath = path.join(__dirname, "..", "index.js");
        try {
          await execa("node", [cliPath, "up", projectName], {
            cwd: workingDir,
            stdio: "pipe",
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          const execaError = toExecError(error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: execaError.stderr || execaError.message || "Failed to start project"
          }));
        }
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

        // Persist logs to storage in background
        persistLogs(projectDir, logs).catch(() => {});

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ logs }));
        return;
      }

      // GET /api/projects/:name/logs/search - Search stored logs
      const logsSearchMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/logs\/search$/);
      if (req.method === "GET" && logsSearchMatch) {
        const projectName = logsSearchMatch[1];
        const projectDir = path.join(workingDir, projectName);

        const service = url.searchParams.get("service") || undefined;
        const level = url.searchParams.get("level") || undefined;
        const query = url.searchParams.get("q") || undefined;
        const startTime = url.searchParams.get("start") || undefined;
        const endTime = url.searchParams.get("end") || undefined;
        const limit = url.searchParams.get("limit")
          ? parseInt(url.searchParams.get("limit")!, 10)
          : 500;

        const logs = await searchLogs(projectDir, {
          service,
          level,
          query,
          startTime,
          endTime,
          limit,
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ logs, count: logs.length }));
        return;
      }

      // GET /api/projects/:name/logs/config - Get log retention config
      const logConfigMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/logs\/config$/);
      if (req.method === "GET" && logConfigMatch) {
        const projectName = logConfigMatch[1];
        const projectDir = path.join(workingDir, projectName);

        const config = await loadLogConfig(projectDir);
        const stats = await getLogStorageStats(projectDir);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ config, stats }));
        return;
      }

      // PUT /api/projects/:name/logs/config - Update log retention config
      const logConfigUpdateMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/logs\/config$/);
      if (req.method === "PUT" && logConfigUpdateMatch) {
        const projectName = logConfigUpdateMatch[1];
        const projectDir = path.join(workingDir, projectName);
        const body = await readBody(req);
        const config = JSON.parse(body) as LogRetentionConfig;

        await saveLogConfig(projectDir, config);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // POST /api/projects/:name/logs/rotate - Force log rotation
      const logRotateMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/logs\/rotate$/);
      if (req.method === "POST" && logRotateMatch) {
        const projectName = logRotateMatch[1];
        const projectDir = path.join(workingDir, projectName);

        await forceRotate(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // DELETE /api/projects/:name/logs/stored - Clear stored logs
      const logClearMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/logs\/stored$/);
      if (req.method === "DELETE" && logClearMatch) {
        const projectName = logClearMatch[1];
        const projectDir = path.join(workingDir, projectName);

        await clearLogs(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
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

      // GET /api/projects/:name/metrics - Get container metrics
      const metricsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/metrics$/);
      if (req.method === "GET" && metricsMatch) {
        const projectName = metricsMatch[1];
        const projectDir = path.join(workingDir, projectName);
        const metrics = await getContainerMetrics(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(metrics));
        return;
      }

      // GET /api/projects/:name/health - Get service health status
      const healthMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/health$/);
      if (req.method === "GET" && healthMatch) {
        const projectName = healthMatch[1];
        const projectDir = path.join(workingDir, projectName);
        const health = await checkServiceHealth(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(health));
        return;
      }

      // GET /api/projects/:name/metrics/history - Get historical metrics
      const historyMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/metrics\/history$/);
      if (req.method === "GET" && historyMatch) {
        const projectName = historyMatch[1];
        const projectDir = path.join(workingDir, projectName);

        // Parse query params
        const startTime = url.searchParams.get("start")
          ? parseInt(url.searchParams.get("start")!, 10)
          : Date.now() - 3600000; // Default: last hour
        const endTime = url.searchParams.get("end")
          ? parseInt(url.searchParams.get("end")!, 10)
          : Date.now();
        const limit = url.searchParams.get("limit")
          ? parseInt(url.searchParams.get("limit")!, 10)
          : 500;

        const metrics = await loadMetrics(projectDir, { startTime, endTime, limit });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ metrics, count: metrics.length }));
        return;
      }

      // GET /api/projects/:name/metrics/summary - Get aggregated metrics summary
      const summaryMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/metrics\/summary$/);
      if (req.method === "GET" && summaryMatch) {
        const projectName = summaryMatch[1];
        const projectDir = path.join(workingDir, projectName);

        const startTime = url.searchParams.get("start")
          ? parseInt(url.searchParams.get("start")!, 10)
          : undefined;
        const endTime = url.searchParams.get("end")
          ? parseInt(url.searchParams.get("end")!, 10)
          : undefined;

        const summary = await getMetricsSummary(projectDir, { startTime, endTime });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(summary));
        return;
      }

      // GET /api/projects/:name/metrics/storage - Get storage info
      const storageMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/metrics\/storage$/);
      if (req.method === "GET" && storageMatch) {
        const projectName = storageMatch[1];
        const projectDir = path.join(workingDir, projectName);

        const info = await getStorageInfo(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(info));
        return;
      }

      // POST /api/projects/:name/metrics/export - Export metrics to file
      const exportMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/metrics\/export$/);
      if (req.method === "POST" && exportMatch) {
        const projectName = exportMatch[1];
        const projectDir = path.join(workingDir, projectName);
        const body = await readBody(req);
        const { format = "json", start, end } = JSON.parse(body || "{}");

        const startTime = start ? parseInt(start, 10) : undefined;
        const endTime = end ? parseInt(end, 10) : undefined;

        // Generate export file path
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const outputDir = path.join(projectDir, ".blissful-infra", "exports");
        await fs.mkdir(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, `metrics-${timestamp}.${format}`);

        let count: number;
        if (format === "csv") {
          count = await exportMetricsToCsv(projectDir, outputPath, { startTime, endTime });
        } else {
          count = await exportMetricsToJson(projectDir, outputPath, { startTime, endTime });
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, path: outputPath, count, format }));
        return;
      }

      // DELETE /api/projects/:name/metrics - Clear metrics history
      const clearMetricsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/metrics$/);
      if (req.method === "DELETE" && clearMetricsMatch) {
        const projectName = clearMetricsMatch[1];
        const projectDir = path.join(workingDir, projectName);

        await clearMetrics(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // GET /api/projects/:name/alerts - Get active alerts and config
      const alertsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/alerts$/);
      if (req.method === "GET" && alertsMatch) {
        const projectName = alertsMatch[1];
        const projectDir = path.join(workingDir, projectName);

        await initializeAlerts(projectDir);
        const config = await loadAlertsConfig(projectDir);
        const activeAlerts = await getActiveAlerts(projectDir);
        const history = await getAlertHistory(projectDir, 20);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ config, activeAlerts, recentHistory: history }));
        return;
      }

      // PUT /api/projects/:name/alerts/config - Update alerts config
      const alertsConfigMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/alerts\/config$/);
      if (req.method === "PUT" && alertsConfigMatch) {
        const projectName = alertsConfigMatch[1];
        const projectDir = path.join(workingDir, projectName);
        const body = await readBody(req);
        const config = JSON.parse(body);

        await saveAlertsConfig(projectDir, config);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // POST /api/projects/:name/alerts/thresholds - Add new threshold
      const addThresholdMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/alerts\/thresholds$/);
      if (req.method === "POST" && addThresholdMatch) {
        const projectName = addThresholdMatch[1];
        const projectDir = path.join(workingDir, projectName);
        const body = await readBody(req);
        const thresholdData = JSON.parse(body) as Omit<AlertThreshold, "id">;

        const newThreshold = await addThreshold(projectDir, thresholdData);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, threshold: newThreshold }));
        return;
      }

      // PUT /api/projects/:name/alerts/thresholds/:id - Update threshold
      const updateThresholdMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/alerts\/thresholds\/([^/]+)$/);
      if (req.method === "PUT" && updateThresholdMatch) {
        const projectName = updateThresholdMatch[1];
        const thresholdId = updateThresholdMatch[2];
        const projectDir = path.join(workingDir, projectName);
        const body = await readBody(req);
        const updates = JSON.parse(body);

        const success = await updateThreshold(projectDir, thresholdId, updates);
        res.writeHead(success ? 200 : 404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success }));
        return;
      }

      // DELETE /api/projects/:name/alerts/thresholds/:id - Delete threshold
      const deleteThresholdMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/alerts\/thresholds\/([^/]+)$/);
      if (req.method === "DELETE" && deleteThresholdMatch) {
        const projectName = deleteThresholdMatch[1];
        const thresholdId = deleteThresholdMatch[2];
        const projectDir = path.join(workingDir, projectName);

        const success = await deleteThreshold(projectDir, thresholdId);
        res.writeHead(success ? 200 : 404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success }));
        return;
      }

      // POST /api/projects/:name/alerts/acknowledge - Acknowledge all active alerts
      const ackAlertsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/alerts\/acknowledge$/);
      if (req.method === "POST" && ackAlertsMatch) {
        const projectName = ackAlertsMatch[1];
        const projectDir = path.join(workingDir, projectName);

        const count = await acknowledgeAlerts(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, acknowledged: count }));
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

      // Phase 2: Pipeline and Deployment Endpoints

      // GET /api/projects/:name/environments - List all environments
      const envsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/environments$/);
      if (req.method === "GET" && envsMatch) {
        const projectName = envsMatch[1];
        const projectDir = path.join(workingDir, projectName);
        const environments = await getProjectEnvironments(projectDir, projectName);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ environments }));
        return;
      }

      // POST /api/projects/:name/deploy - Trigger deployment
      const deployMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/deploy$/);
      if (req.method === "POST" && deployMatch) {
        const projectName = deployMatch[1];
        const body = await readBody(req);
        const { env = "staging", image } = JSON.parse(body || "{}");

        const cliPath = path.join(__dirname, "..", "index.js");
        try {
          const args = ["deploy", projectName, "--env", env];
          if (image) args.push("--image", image);

          await execa("node", [cliPath, ...args], {
            cwd: workingDir,
            stdio: "pipe",
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, environment: env }));
        } catch (error) {
          const execaError = toExecError(error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: execaError.stderr || execaError.message || "Deployment failed"
          }));
        }
        return;
      }

      // POST /api/projects/:name/rollback - Trigger rollback
      const rollbackMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/rollback$/);
      if (req.method === "POST" && rollbackMatch) {
        const projectName = rollbackMatch[1];
        const body = await readBody(req);
        const { env = "staging", revision } = JSON.parse(body || "{}");

        const cliPath = path.join(__dirname, "..", "index.js");
        try {
          const args = ["rollback", projectName, "--env", env];
          if (revision) args.push("--revision", revision);

          await execa("node", [cliPath, ...args], {
            cwd: workingDir,
            stdio: "pipe",
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, environment: env }));
        } catch (error) {
          const execaError = toExecError(error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: execaError.stderr || execaError.message || "Rollback failed"
          }));
        }
        return;
      }

      // GET /api/projects/:name/pipeline - Get pipeline status
      const pipelineMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/pipeline$/);
      if (req.method === "GET" && pipelineMatch) {
        const projectName = pipelineMatch[1];
        const projectDir = path.join(workingDir, projectName);
        const pipelineStatus = await getPipelineStatus(projectDir, projectName);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(pipelineStatus));
        return;
      }

      // POST /api/projects/:name/pipeline - Run pipeline locally
      const pipelineRunMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/pipeline$/);
      if (req.method === "POST" && pipelineRunMatch) {
        const projectName = pipelineRunMatch[1];
        const body = await readBody(req);
        const { push = false, skipTests = false, skipScan = false } = JSON.parse(body || "{}");

        const cliPath = path.join(__dirname, "..", "index.js");
        try {
          const args = ["pipeline", projectName, "--local"];
          if (push) args.push("--push");
          if (skipTests) args.push("--skip-tests");
          if (skipScan) args.push("--skip-scan");

          await execa("node", [cliPath, ...args], {
            cwd: workingDir,
            stdio: "pipe",
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          const execaError = toExecError(error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: execaError.stderr || execaError.message || "Pipeline failed"
          }));
        }
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
    const args = ["create", name, "--template", type, "--deploy", "local-only"];

    if (type !== "frontend") {
      args.push("--backend", backend);
    }
    if (type !== "backend") {
      args.push("--frontend", frontend);
    }
    // Always pass database to avoid interactive prompt
    args.push("--database", database || "none");

    // Get the CLI path
    const cliPath = path.join(__dirname, "..", "index.js");

    await execa("node", [cliPath, ...args], {
      cwd: workingDir,
      stdio: "pipe",
    });

    return { success: true };
  } catch (error) {
    // Extract stderr for more useful error messages
    const execaError = toExecError(error);
    const errorMessage = execaError.stderr || execaError.message || "Failed to create project";
    return {
      success: false,
      error: errorMessage,
    };
  }
}

async function getContainerMetrics(projectDir: string, saveToStorage = true): Promise<ProjectMetrics> {
  const containers: ContainerMetrics[] = [];
  const config = await loadConfig(projectDir);
  const projectName = config?.name || path.basename(projectDir);

  try {
    // Get container IDs for this project
    const { stdout: psOutput } = await execa(
      "docker",
      ["compose", "ps", "-q"],
      { cwd: projectDir, reject: false }
    );

    const containerIds = psOutput.trim().split("\n").filter(Boolean);

    if (containerIds.length === 0) {
      return { containers: [], timestamp: Date.now() };
    }

    // Get stats for all containers (--no-stream returns single snapshot)
    const { stdout: statsOutput } = await execa(
      "docker",
      ["stats", "--no-stream", "--format", "json", ...containerIds],
      { reject: false }
    );

    // Parse each line of JSON output
    const lines = statsOutput.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const stat = JSON.parse(line);

        // Parse CPU percentage (e.g., "0.50%")
        const cpuPercent = parseFloat(stat.CPUPerc?.replace("%", "") || "0");

        // Parse memory usage (e.g., "50.5MiB / 1GiB")
        const memParts = stat.MemUsage?.split(" / ") || ["0", "0"];
        const memoryUsage = parseMemoryValue(memParts[0]);
        const memoryLimit = parseMemoryValue(memParts[1]);
        const memoryPercent = parseFloat(stat.MemPerc?.replace("%", "") || "0");

        // Parse network I/O (e.g., "1.5kB / 2.3kB")
        const netParts = stat.NetIO?.split(" / ") || ["0", "0"];
        const networkRx = parseMemoryValue(netParts[0]);
        const networkTx = parseMemoryValue(netParts[1]);

        containers.push({
          name: stat.Name || "unknown",
          cpuPercent,
          memoryUsage,
          memoryLimit,
          memoryPercent,
          networkRx,
          networkTx,
        });
      } catch {
        // Skip invalid JSON lines
      }
    }
  } catch {
    // Docker stats failed
  }

  // Try to fetch HTTP metrics from Spring Boot Actuator
  const httpMetrics = await fetchActuatorMetrics();

  // Save metrics to storage for historical access
  if (saveToStorage && containers.length > 0) {
    try {
      const containerData: ContainerMetricsData[] = containers.map((c) => ({
        name: c.name,
        cpuPercent: c.cpuPercent,
        memoryPercent: c.memoryPercent,
        memoryUsage: c.memoryUsage,
        memoryLimit: c.memoryLimit,
        networkRx: c.networkRx,
        networkTx: c.networkTx,
      }));

      const httpData: HttpMetricsData | undefined = httpMetrics
        ? {
            totalRequests: httpMetrics.totalRequests,
            avgResponseTime: httpMetrics.avgResponseTime,
            p50Latency: httpMetrics.p50Latency,
            p95Latency: httpMetrics.p95Latency,
            p99Latency: httpMetrics.p99Latency,
            errorRate: httpMetrics.errorRate,
            status2xx: httpMetrics.status2xx,
            status4xx: httpMetrics.status4xx,
            status5xx: httpMetrics.status5xx,
          }
        : undefined;

      await saveMetrics(projectDir, projectName, containerData, httpData);

      // Check alerts against current metrics
      const alertSnapshot: MetricsSnapshot = {
        containers: containers.map((c) => ({
          name: c.name,
          cpuPercent: c.cpuPercent,
          memoryPercent: c.memoryPercent,
        })),
        http: httpMetrics
          ? {
              errorRate: httpMetrics.errorRate,
              p95Latency: httpMetrics.p95Latency,
              p99Latency: httpMetrics.p99Latency,
            }
          : undefined,
      };
      await checkAlerts(projectDir, alertSnapshot);
    } catch {
      // Ignore storage/alert errors - don't affect metrics collection
    }
  }

  return { containers, httpMetrics, timestamp: Date.now() };
}

async function checkServiceHealth(projectDir: string): Promise<HealthResponse> {
  const services: ServiceHealth[] = [];
  const config = await loadConfig(projectDir);

  // Define health check endpoints based on project config
  const healthChecks: Array<{ name: string; url: string; port: number }> = [];

  // Backend health check (Spring Boot Actuator)
  if (config?.backend === "spring-boot") {
    healthChecks.push({ name: "backend", url: "http://localhost:8080/actuator/health", port: 8080 });
  } else if (config?.backend === "fastapi") {
    healthChecks.push({ name: "backend", url: "http://localhost:8000/health", port: 8000 });
  } else if (config?.backend === "express") {
    healthChecks.push({ name: "backend", url: "http://localhost:3001/health", port: 3001 });
  } else if (config?.backend === "go-chi") {
    healthChecks.push({ name: "backend", url: "http://localhost:8080/health", port: 8080 });
  }

  // Frontend health check
  if (config?.frontend) {
    healthChecks.push({ name: "frontend", url: "http://localhost:3000", port: 3000 });
  }

  // Database health checks
  if (config?.database === "postgres" || config?.database === "postgres-redis") {
    // PostgreSQL - check via docker exec
    healthChecks.push({ name: "postgres", url: "", port: 5432 });
  }
  if (config?.database === "redis" || config?.database === "postgres-redis") {
    healthChecks.push({ name: "redis", url: "", port: 6379 });
  }

  // Kafka health check
  if (config?.type !== "frontend") {
    healthChecks.push({ name: "kafka", url: "", port: 9092 });
  }

  // Check each service
  for (const check of healthChecks) {
    const startTime = Date.now();
    let status: "healthy" | "unhealthy" | "unknown" = "unknown";
    let responseTimeMs: number | undefined;
    let details: string | undefined;

    try {
      if (check.url) {
        // HTTP health check
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(check.url, { signal: controller.signal });
        clearTimeout(timeout);

        responseTimeMs = Date.now() - startTime;

        if (response.ok) {
          status = "healthy";
          // Try to parse health details from Spring Boot
          if (check.name === "backend" && config?.backend === "spring-boot") {
            try {
              const data = await response.json() as { status?: string };
              details = data.status || "UP";
            } catch {
              details = "UP";
            }
          }
        } else {
          status = "unhealthy";
          details = `HTTP ${response.status}`;
        }
      } else {
        // Port-based health check (for databases, kafka)
        const { stdout } = await execa(
          "docker",
          ["compose", "ps", "--format", "json"],
          { cwd: projectDir, reject: false }
        );

        const lines = stdout.trim().split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const container = JSON.parse(line);
            const serviceName = container.Service || container.Name || "";
            if (serviceName.toLowerCase().includes(check.name)) {
              const state = container.State?.toLowerCase() || "";
              const health = container.Health?.toLowerCase() || "";

              if (state === "running") {
                status = health === "healthy" || !health ? "healthy" : "unhealthy";
              } else {
                status = "unhealthy";
              }
              details = state;
              break;
            }
          } catch {
            // Skip invalid JSON
          }
        }
        responseTimeMs = Date.now() - startTime;
      }
    } catch (error) {
      responseTimeMs = Date.now() - startTime;
      status = "unhealthy";
      details = error instanceof Error ? error.message : "Connection failed";
    }

    services.push({
      name: check.name,
      status,
      responseTimeMs,
      lastChecked: Date.now(),
      details,
    });
  }

  return { services, timestamp: Date.now() };
}

async function fetchActuatorMetrics(): Promise<HttpMetrics | undefined> {
  try {
    // Try to fetch from Spring Boot Actuator on port 8080
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    // Fetch base metrics
    const response = await fetch("http://localhost:8080/actuator/metrics/http.server.requests", {
      signal: controller.signal,
    });

    if (!response.ok) {
      clearTimeout(timeout);
      return undefined;
    }

    const data = await response.json() as {
      measurements?: Array<{ statistic: string; value: number }>;
    };

    // Parse Micrometer metrics format
    let totalRequests = 0;
    let totalTime = 0;

    for (const measurement of data.measurements || []) {
      if (measurement.statistic === "COUNT") {
        totalRequests = measurement.value;
      } else if (measurement.statistic === "TOTAL_TIME") {
        totalTime = measurement.value;
      }
    }

    const avgResponseTime = totalRequests > 0 ? (totalTime / totalRequests) * 1000 : 0; // Convert to ms

    // Fetch Prometheus metrics for percentiles and error rates
    let p50Latency: number | undefined;
    let p95Latency: number | undefined;
    let p99Latency: number | undefined;
    let status2xx = 0;
    let status4xx = 0;
    let status5xx = 0;

    try {
      const promResponse = await fetch("http://localhost:8080/actuator/prometheus", {
        signal: controller.signal,
      });

      if (promResponse.ok) {
        const promText = await promResponse.text();
        const lines = promText.split("\n");

        for (const line of lines) {
          // Parse percentile metrics: http_server_requests_seconds{...,quantile="0.5",...} value
          if (line.startsWith("http_server_requests_seconds") && !line.startsWith("#")) {
            const quantileMatch = line.match(/quantile="([^"]+)"/);
            const valueMatch = line.match(/\}\s+([\d.]+(?:E[+-]?\d+)?)/);

            if (quantileMatch && valueMatch) {
              const quantile = parseFloat(quantileMatch[1]);
              const value = parseFloat(valueMatch[1]) * 1000; // Convert to ms

              if (quantile === 0.5) p50Latency = value;
              else if (quantile === 0.95) p95Latency = value;
              else if (quantile === 0.99) p99Latency = value;
            }
          }

          // Parse status code counts from http_requests_total or http_server_requests_seconds_count
          if ((line.startsWith("http_requests_total") || line.startsWith("http_server_requests_seconds_count")) && !line.startsWith("#")) {
            const statusMatch = line.match(/status="(\d+)"/);
            const valueMatch = line.match(/\}\s+([\d.]+)/);

            if (statusMatch && valueMatch) {
              const status = parseInt(statusMatch[1], 10);
              const count = parseFloat(valueMatch[1]);

              if (status >= 200 && status < 300) status2xx += count;
              else if (status >= 400 && status < 500) status4xx += count;
              else if (status >= 500 && status < 600) status5xx += count;
            }
          }
        }
      }
    } catch {
      // Prometheus endpoint not available
    }

    clearTimeout(timeout);

    const errorCount = status5xx;
    const totalForError = status2xx + status4xx + status5xx;
    const errorRate = totalForError > 0 ? (errorCount / totalForError) * 100 : 0;

    return {
      totalRequests,
      requestsPerSecond: 0, // Will be calculated on frontend from delta
      avgResponseTime,
      p50Latency,
      p95Latency,
      p99Latency,
      errorCount,
      errorRate,
      status2xx,
      status4xx,
      status5xx,
    };
  } catch {
    // Actuator not available or error
    return undefined;
  }
}

function parseMemoryValue(value: string): number {
  if (!value) return 0;
  const num = parseFloat(value);
  if (isNaN(num)) return 0;

  const upper = value.toUpperCase();
  if (upper.includes("GIB") || upper.includes("GB")) return num * 1024 * 1024 * 1024;
  if (upper.includes("MIB") || upper.includes("MB")) return num * 1024 * 1024;
  if (upper.includes("KIB") || upper.includes("KB")) return num * 1024;
  if (upper.includes("B")) return num;
  return num;
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

// Phase 2: Helper functions for deployment and pipeline

interface EnvironmentInfo {
  name: string;
  version: string;
  status: "Synced" | "OutOfSync" | "Progressing" | "Missing" | "Unknown";
  health: "Healthy" | "Degraded" | "Progressing" | "Missing" | "Unknown";
  replicas: string;
  lastDeployed?: string;
}

interface PipelineStatus {
  lastRun?: {
    status: "success" | "failure" | "running" | "unknown";
    duration?: number;
    timestamp?: string;
    stages: Array<{
      name: string;
      status: "success" | "failure" | "running" | "skipped" | "pending";
    }>;
  };
  jenkinsUrl?: string;
}

async function getProjectEnvironments(
  projectDir: string,
  projectName: string
): Promise<EnvironmentInfo[]> {
  const environments: EnvironmentInfo[] = [];
  const config = await loadConfig(projectDir);

  // Check local environment
  try {
    const { stdout } = await execa("docker", ["compose", "ps", "--format", "json"], {
      cwd: projectDir,
      reject: false,
    });

    const containers = stdout.trim().split("\n").filter(Boolean);
    if (containers.length > 0) {
      const anyRunning = containers.some((line: string) => {
        try {
          const c = JSON.parse(line);
          return c.State?.toLowerCase() === "running";
        } catch {
          return false;
        }
      });

      environments.push({
        name: "local",
        version: "dev",
        status: anyRunning ? "Synced" : "OutOfSync",
        health: anyRunning ? "Healthy" : "Degraded",
        replicas: anyRunning ? "1/1" : "0/1",
      });
    }
  } catch {
    // Local environment not available
  }

  // Check Kubernetes environments if not local-only
  if (config?.deployTarget !== "local-only") {
    const kubeEnvs = ["staging", "production"];

    for (const env of kubeEnvs) {
      const namespace = `${projectName}-${env}`;

      try {
        // Try to get deployment status
        const { stdout } = await execa("kubectl", [
          "get",
          "deployment",
          projectName,
          "-n",
          namespace,
          "-o",
          "json",
        ], { stdio: "pipe", reject: false });

        if (stdout) {
          const deployment = JSON.parse(stdout);
          const available = deployment.status?.availableReplicas || 0;
          const desired = deployment.spec?.replicas || 0;
          const imageTag = deployment.spec?.template?.spec?.containers?.[0]?.image?.split(":")[1] || "latest";

          environments.push({
            name: env,
            version: imageTag.substring(0, 7),
            status: available === desired ? "Synced" : "Progressing",
            health: available === desired ? "Healthy" : "Progressing",
            replicas: `${available}/${desired}`,
          });
        }
      } catch {
        environments.push({
          name: env,
          version: "-",
          status: "Missing",
          health: "Missing",
          replicas: "-",
        });
      }
    }

    // Check for ephemeral environments
    try {
      const { stdout } = await execa("kubectl", [
        "get",
        "namespaces",
        "-l",
        "ephemeral=true",
        "-o",
        "jsonpath={.items[*].metadata.name}",
      ], { stdio: "pipe", reject: false });

      const namespaces = stdout.split(" ").filter((n: string) => n.startsWith(`${projectName}-pr-`));

      for (const ns of namespaces) {
        const prNumber = ns.replace(`${projectName}-pr-`, "");
        try {
          const { stdout: depOutput } = await execa("kubectl", [
            "get",
            "deployment",
            projectName,
            "-n",
            ns,
            "-o",
            "json",
          ], { stdio: "pipe" });

          const deployment = JSON.parse(depOutput);
          const available = deployment.status?.availableReplicas || 0;
          const desired = deployment.spec?.replicas || 0;

          environments.push({
            name: `PR #${prNumber}`,
            version: deployment.spec?.template?.spec?.containers?.[0]?.image?.split(":")[1]?.substring(0, 7) || "latest",
            status: available === desired ? "Synced" : "Progressing",
            health: available === desired ? "Healthy" : "Progressing",
            replicas: `${available}/${desired}`,
          });
        } catch {
          // Skip if deployment not found
        }
      }
    } catch {
      // No ephemeral namespaces or kubectl not available
    }
  }

  return environments;
}

async function getPipelineStatus(
  projectDir: string,
  projectName: string
): Promise<PipelineStatus> {
  // Check if Jenkinsfile exists
  let hasJenkinsfile = false;
  try {
    await fs.access(path.join(projectDir, "Jenkinsfile"));
    hasJenkinsfile = true;
  } catch {
    // No Jenkinsfile
  }

  return {
    lastRun: undefined, // Would need Jenkins API integration
    jenkinsUrl: hasJenkinsfile ? `http://localhost:8080/job/${projectName}` : undefined,
  };
}
