import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { loadConfig, findProjectDir, type ProjectConfig } from "../utils/config.js";
import { checkPorts, getRequiredPorts } from "../utils/ports.js";
import { toExecError } from "../utils/errors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..");

async function ensureDashboardImage(): Promise<void> {
  try {
    await execa("docker", ["image", "inspect", "blissful-infra-dashboard:latest"], { stdio: "pipe" });
  } catch {
    const spinner = ora("Building dashboard image (first time only)...").start();
    try {
      await execa("docker", [
        "build", "-f", "Dockerfile.dashboard",
        "-t", "blissful-infra-dashboard:latest", ".",
      ], { cwd: REPO_ROOT, stdio: "pipe" });
      spinner.succeed("Dashboard image built");
    } catch (error) {
      spinner.fail("Failed to build dashboard image");
      const execError = toExecError(error);
      if (execError.stderr) {
        console.error(chalk.dim(execError.stderr));
      }
      throw error;
    }
  }
}

async function checkDockerRunning(): Promise<boolean> {
  try {
    await execa("docker", ["info"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function startEnvironment(config: ProjectConfig, projectDir: string): Promise<void> {
  const spinner = ora("Starting local environment...").start();

  // Check for docker-compose.yaml
  const composeFile = path.join(projectDir, "docker-compose.yaml");
  let hasCompose = false;

  try {
    await fs.access(composeFile);
    hasCompose = true;
  } catch {
    // No compose file yet
  }

  if (!hasCompose) {
    spinner.info("No docker-compose.yaml found, generating...");
    await generateDockerCompose(config, projectDir);
  }

  spinner.text = "Starting containers...";

  try {
    await execa("docker", ["compose", "up", "-d"], {
      cwd: projectDir,
      stdio: "inherit",
    });

    spinner.succeed("Environment started");

    console.log();
    console.log(chalk.green("Services running:"));

    const isFrontendOnly = config.type === "frontend";
    const isFullstack = config.type === "fullstack";

    // Show expected services based on config
    if (isFrontendOnly) {
      console.log(chalk.dim("  • Frontend:    ") + chalk.cyan("http://localhost:3000"));
    } else if (isFullstack) {
      console.log(chalk.dim("  • Frontend:    ") + chalk.cyan("http://localhost:3000"));
      console.log(chalk.dim("  • Backend:     ") + chalk.cyan("http://localhost:8080"));
    } else {
      console.log(chalk.dim("  • Application: ") + chalk.cyan("http://localhost:8080"));
    }

    if (config.database === "postgres" || config.database === "postgres-redis") {
      console.log(chalk.dim("  • PostgreSQL:  ") + chalk.cyan("localhost:5432"));
    }

    if (config.database === "redis" || config.database === "postgres-redis") {
      console.log(chalk.dim("  • Redis:       ") + chalk.cyan("localhost:6379"));
    }

    if (!isFrontendOnly) {
      console.log(chalk.dim("  • Kafka:       ") + chalk.cyan("localhost:9092"));
      console.log(chalk.dim("  • Nginx:       ") + chalk.cyan("http://localhost"));
    }

    const aiPipelinesOut = config.plugins?.filter(p => p.type === "ai-pipeline") || [];
    aiPipelinesOut.forEach((plugin, index) => {
      const cfg = config.pluginConfigs?.[plugin.instance];
      const port = cfg?.port ?? (8090 + index);
      const label = aiPipelinesOut.length > 1 ? `AI Pipeline (${plugin.instance})` : "AI Pipeline";
      console.log(chalk.dim(`  • ${label}: `) + chalk.cyan(`http://localhost:${port}`));
    });

    const agentServicesOut = config.plugins?.filter(p => p.type === "agent-service") || [];
    agentServicesOut.forEach((plugin, index) => {
      const cfg = config.pluginConfigs?.[plugin.instance];
      const port = cfg?.port ?? (8095 + index);
      const label = agentServicesOut.length > 1 ? `Agent (${plugin.instance})` : "Agent Service";
      console.log(chalk.dim(`  • ${label}: `) + chalk.cyan(`http://localhost:${port}`));
    });

    console.log(chalk.dim("  • Dashboard:   ") + chalk.cyan("http://localhost:3002"));

    console.log();
    console.log(chalk.dim("Run"), chalk.cyan("blissful-infra logs"), chalk.dim("to view logs"));
    console.log(chalk.dim("Run"), chalk.cyan("blissful-infra down"), chalk.dim("to stop"));
    console.log();
  } catch (error) {
    spinner.fail("Failed to start environment");
    throw error;
  }
}

async function generateDockerCompose(config: ProjectConfig, projectDir: string): Promise<void> {
  const services: Record<string, unknown> = {};
  const isFrontendOnly = config.type === "frontend";
  const isFullstack = config.type === "fullstack";

  // Kafka service (KRaft mode - no Zookeeper) - skip for frontend-only
  if (!isFrontendOnly) {
    services.kafka = {
    image: "apache/kafka:3.7.0",
    container_name: `${config.name}-kafka`,
    hostname: "kafka",
    ports: ["9092:9092", "9094:9094"],
    environment: {
      KAFKA_NODE_ID: 1,
      KAFKA_PROCESS_ROLES: "broker,controller",
      KAFKA_LISTENERS: "PLAINTEXT://0.0.0.0:9094,CONTROLLER://0.0.0.0:9093,EXTERNAL://0.0.0.0:9092",
      KAFKA_ADVERTISED_LISTENERS: "PLAINTEXT://kafka:9094,EXTERNAL://localhost:9092",
      KAFKA_CONTROLLER_QUORUM_VOTERS: "1@kafka:9093",
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP:
        "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,EXTERNAL:PLAINTEXT",
      KAFKA_CONTROLLER_LISTENER_NAMES: "CONTROLLER",
      KAFKA_INTER_BROKER_LISTENER_NAME: "PLAINTEXT",
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1,
      CLUSTER_ID: "blissful-infra-kafka-cluster",
    },
    healthcheck: {
      test: ["CMD-SHELL", "/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server kafka:9094 || exit 1"],
      interval: "10s",
      timeout: "10s",
      retries: 10,
      start_period: "30s",
    },
  };
  }

  // PostgreSQL (if selected)
  if (config.database === "postgres" || config.database === "postgres-redis") {
    services.postgres = {
      image: "postgres:16-alpine",
      container_name: `${config.name}-postgres`,
      ports: ["5432:5432"],
      environment: {
        POSTGRES_USER: config.name.replace(/-/g, "_"),
        POSTGRES_PASSWORD: "localdev",
        POSTGRES_DB: config.name.replace(/-/g, "_"),
      },
      volumes: [`${config.name}-postgres-data:/var/lib/postgresql/data`],
      healthcheck: {
        test: ["CMD-SHELL", `pg_isready -U ${config.name.replace(/-/g, "_")}`],
        interval: "5s",
        timeout: "3s",
        retries: 5,
      },
    };
  }

  // Redis (if selected)
  if (config.database === "redis" || config.database === "postgres-redis") {
    services.redis = {
      image: "redis:7-alpine",
      container_name: `${config.name}-redis`,
      ports: ["6379:6379"],
      healthcheck: {
        test: ["CMD", "redis-cli", "ping"],
        interval: "5s",
        timeout: "3s",
        retries: 5,
      },
    };
  }

  // Backend application service (for backend or fullstack templates)
  if (!isFrontendOnly) {
    services.app = {
      build: {
        context: isFullstack ? "./backend" : ".",
        dockerfile: "Dockerfile",
      },
      container_name: `${config.name}-app`,
      ports: ["8080:8080"],
      environment: {
        KAFKA_BOOTSTRAP_SERVERS: "kafka:9094",
        ...(config.database === "postgres" || config.database === "postgres-redis"
          ? {
              DATABASE_URL: `postgresql://${config.name.replace(/-/g, "_")}:localdev@postgres:5432/${config.name.replace(/-/g, "_")}`,
            }
          : {}),
        ...(config.database === "redis" || config.database === "postgres-redis"
          ? { REDIS_URL: "redis://redis:6379" }
          : {}),
      },
      depends_on: {
        kafka: { condition: "service_healthy" },
        ...(config.database === "postgres" || config.database === "postgres-redis"
          ? { postgres: { condition: "service_healthy" } }
          : {}),
        ...(config.database === "redis" || config.database === "postgres-redis"
          ? { redis: { condition: "service_healthy" } }
          : {}),
      },
    };
  }

  // Frontend service (for frontend-only or fullstack templates)
  if (isFrontendOnly || isFullstack) {
    services.frontend = {
      build: {
        context: isFullstack ? "./frontend" : ".",
        dockerfile: "Dockerfile",
      },
      container_name: `${config.name}-frontend`,
      ports: ["3000:80"],
      ...(isFullstack ? {
        depends_on: ["app"],
      } : {}),
    };
  }

  // Nginx reverse proxy (for projects with a backend)
  if (!isFrontendOnly) {
    const dependsOn = isFullstack ? ["app", "frontend"] : ["app"];
    services.nginx = {
      image: "nginx:alpine",
      container_name: `${config.name}-nginx`,
      ports: ["80:80"],
      volumes: ["./nginx.conf:/etc/nginx/conf.d/default.conf:ro"],
      depends_on: dependsOn,
    };

    // Generate nginx.conf
    await generateNginxConf(config, projectDir, isFullstack);
  }

  // AI Pipeline plugins
  const aiPipelines = config.plugins?.filter(p => p.type === "ai-pipeline") || [];
  aiPipelines.forEach((plugin, index) => {
    const cfg = config.pluginConfigs?.[plugin.instance];
    const port = cfg?.port ?? (8090 + index);
    services[plugin.instance] = {
      build: {
        context: `./${plugin.instance}`,
        dockerfile: "Dockerfile",
      },
      container_name: `${config.name}-${plugin.instance}`,
      ports: [`${port}:${port}`],
      environment: {
        PROJECT_NAME: config.name,
        INSTANCE_NAME: plugin.instance,
        KAFKA_BOOTSTRAP_SERVERS: "kafka:9094",
        PIPELINE_MODE: cfg?.mode ?? "streaming",
        SPARK_MASTER: "local[*]",
        API_PORT: String(port),
        EVENTS_TOPIC: cfg?.events_topic ?? "events",
        PREDICTIONS_TOPIC: cfg?.predictions_topic ?? (aiPipelines.length > 1 ? `predictions-${plugin.instance}` : "predictions"),
      },
      depends_on: {
        kafka: { condition: "service_healthy" },
      },
    };
  });

  // Agent service plugins
  const agentServices = config.plugins?.filter(p => p.type === "agent-service") || [];
  agentServices.forEach((plugin, index) => {
    const cfg = config.pluginConfigs?.[plugin.instance];
    const port = cfg?.port ?? (8095 + index);
    services[plugin.instance] = {
      build: {
        context: `./${plugin.instance}`,
        dockerfile: "Dockerfile",
      },
      container_name: `${config.name}-${plugin.instance}`,
      ports: [`${port}:${port}`],
      environment: {
        PROJECT_NAME: config.name,
        INSTANCE_NAME: plugin.instance,
        API_PORT: String(port),
        ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY:-}",
        AI_PROVIDER: "${AI_PROVIDER:-claude}",
        AI_MODEL: "${AI_MODEL:-claude-sonnet-4-20250514}",
        WORKSPACE_DIR: "/workspace",
        STATE_DIR: "/data/agent-state",
      },
      volumes: [
        ".:/workspace:rw",
        `${config.name}-agent-state:/data/agent-state`,
      ],
    };
  });

  // Dashboard service
  services.dashboard = {
    image: "blissful-infra-dashboard:latest",
    container_name: `${config.name}-dashboard`,
    ports: ["3002:3002"],
    environment: {
      PROJECTS_DIR: "/projects",
      DASHBOARD_DIST_DIR: "/app/dashboard-dist",
      DASHBOARD_PORT: "3002",
      DOCKER_MODE: "true",
    },
    volumes: [
      "/var/run/docker.sock:/var/run/docker.sock",
      `.:/projects/${config.name}`,
    ],
  };

  // Build volumes object
  const volumes: Record<string, string | null> = {};
  if (config.database === "postgres" || config.database === "postgres-redis") {
    volumes[`${config.name}-postgres-data`] = null;
  }
  if (agentServices.length > 0) {
    volumes[`${config.name}-agent-state`] = null;
  }

  const compose: Record<string, unknown> = { services };
  if (Object.keys(volumes).length > 0) {
    compose.volumes = volumes;
  }

  // Write docker-compose.yaml
  const yaml = generateYaml(compose);
  await fs.writeFile(path.join(projectDir, "docker-compose.yaml"), yaml);
}

async function generateNginxConf(
  config: ProjectConfig,
  projectDir: string,
  isFullstack: boolean
): Promise<void> {
  const backendPaths = [
    "/hello", "/health", "/ready", "/live", "/startup",
    "/echo", "/greetings", "/ws/", "/actuator",
  ];

  const locationBlocks = backendPaths
    .map((p) => `    location ${p} {\n        proxy_pass http://app:8080;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }`)
    .join("\n\n");

  const wsBlock = `    location /ws/ {
        proxy_pass http://app:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }`;

  let defaultLocation: string;
  if (isFullstack) {
    defaultLocation = `    location / {
        proxy_pass http://frontend:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }`;
  } else {
    defaultLocation = `    location / {
        proxy_pass http://app:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }`;
  }

  // For fullstack: route backend paths to app, everything else to frontend
  // For backend-only: route everything to app
  let serverBlock: string;
  if (isFullstack) {
    serverBlock = `server {
    listen 80;
    server_name localhost;

${locationBlocks}

${wsBlock}

${defaultLocation}
}`;
  } else {
    serverBlock = `server {
    listen 80;
    server_name localhost;

${wsBlock}

${defaultLocation}
}`;
  }

  await fs.writeFile(path.join(projectDir, "nginx.conf"), serverBlock + "\n");
}

function generateYaml(obj: unknown, indent = 0): string {
  const spaces = "  ".repeat(indent);

  if (obj === null) {
    return "";  // Empty value in YAML
  }

  if (obj === undefined) {
    return "null";
  }

  if (typeof obj === "string") {
    // Quote strings that might be interpreted as other types
    if (obj.includes(":") || obj.includes("#") || obj.startsWith("$")) {
      return `"${obj}"`;
    }
    return obj;
  }

  if (typeof obj === "number" || typeof obj === "boolean") {
    return String(obj);
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj.map((item) => `${spaces}- ${generateYaml(item, indent + 1).trimStart()}`).join("\n");
  }

  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "{}";

    return entries
      .map(([key, value]) => {
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          return `${spaces}${key}:\n${generateYaml(value, indent + 1)}`;
        }
        if (Array.isArray(value)) {
          return `${spaces}${key}:\n${generateYaml(value, indent + 1)}`;
        }
        return `${spaces}${key}: ${generateYaml(value, indent)}`;
      })
      .join("\n");
  }

  return String(obj);
}

export async function upAction(name?: string): Promise<void> {
  // Check Docker is running
  if (!(await checkDockerRunning())) {
    console.error(chalk.red("Docker is not running."));
    console.error(chalk.dim("Please start Docker and try again."));
    process.exit(1);
  }

  // Find project directory
  const projectDir = await findProjectDir(name);
  if (!projectDir) {
    if (name) {
      console.error(chalk.red(`Project '${name}' not found.`));
    } else {
      console.error(chalk.red("No blissful-infra.yaml found."));
      console.error(chalk.dim("Run from project directory or specify project name:"));
      console.error(chalk.cyan("  blissful-infra up my-app"));
    }
    process.exit(1);
  }

  // Load project config
  const config = await loadConfig(projectDir);
  if (!config) {
    console.error(chalk.red("No blissful-infra.yaml found."));
    console.error(chalk.dim("Run"), chalk.cyan("blissful-infra create"), chalk.dim("first."));
    process.exit(1);
  }

  // Check for port conflicts
  const requiredPorts = getRequiredPorts(config);
  const portResults = await checkPorts(requiredPorts);
  const conflicts = portResults.filter((p) => p.inUse);

  if (conflicts.length > 0) {
    console.error(chalk.red("Port conflicts detected:"));
    for (const conflict of conflicts) {
      console.error(chalk.dim(`  • Port ${conflict.port} (${conflict.service}) is already in use`));
    }
    console.error();
    console.error(chalk.dim("Stop the conflicting services or use different ports."));
    process.exit(1);
  }

  await ensureDashboardImage();
  await startEnvironment(config, projectDir);
}

export const upCommand = new Command("up")
  .description("Start the local development environment")
  .argument("[name]", "Project name (if running from parent directory)")
  .option("-d, --detach", "Run in background", true)
  .action(async (name: string | undefined) => {
    await upAction(name);
  });
