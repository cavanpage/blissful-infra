import net from "node:net";
import { ProjectConfig } from "./config.js";

export interface PortCheck {
  port: number;
  service: string;
  inUse: boolean;
}

/**
 * Check if a port is in use
 */
export function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve(true); // Port is in use
      } else {
        resolve(false); // Other error, assume port is free
      }
    });

    server.once("listening", () => {
      server.close();
      resolve(false); // Port is free
    });

    server.listen(port, "127.0.0.1");
  });
}

/**
 * Check multiple ports and return their status
 */
export async function checkPorts(
  ports: { port: number; service: string }[]
): Promise<PortCheck[]> {
  const results = await Promise.all(
    ports.map(async ({ port, service }) => ({
      port,
      service,
      inUse: await checkPort(port),
    }))
  );
  return results;
}

/**
 * Get the default ports used by blissful-infra based on config
 */
export function getRequiredPorts(config: ProjectConfig): { port: number; service: string }[] {
  const ports: { port: number; service: string }[] = [];
  const isFrontendOnly = config.type === "frontend";

  // Frontend port
  if (config.type === "frontend" || config.type === "fullstack") {
    ports.push({ port: 3000, service: "Frontend" });
  }

  // Backend port
  if (!isFrontendOnly) {
    ports.push({ port: 8080, service: "Backend" });
  }

  // Kafka ports
  if (!isFrontendOnly) {
    ports.push({ port: 9092, service: "Kafka (external)" });
    ports.push({ port: 9094, service: "Kafka (internal)" });
  }

  // Nginx port
  if (!isFrontendOnly) {
    ports.push({ port: 80, service: "Nginx" });
  }

  // Dashboard port
  ports.push({ port: 3002, service: "Dashboard" });

  // AI Pipeline ports (one per instance)
  const aiPipelines = config.plugins?.filter(p => p.type === "ai-pipeline") || [];
  aiPipelines.forEach((p, i) => {
    ports.push({ port: 8090 + i, service: `AI Pipeline (${p.instance})` });
  });

  // Agent service ports (one per instance)
  const agentServices = config.plugins?.filter(p => p.type === "agent-service") || [];
  agentServices.forEach((p, i) => {
    ports.push({ port: 8095 + i, service: `Agent Service (${p.instance})` });
  });

  // Monitoring ports
  if (config.monitoring === "prometheus") {
    ports.push({ port: 9090, service: "Prometheus" });
    ports.push({ port: 3001, service: "Grafana" });
  }

  // Database ports
  if (config.database === "postgres" || config.database === "postgres-redis") {
    ports.push({ port: 5432, service: "PostgreSQL" });
  }

  if (config.database === "redis" || config.database === "postgres-redis") {
    ports.push({ port: 6379, service: "Redis" });
  }

  return ports;
}
