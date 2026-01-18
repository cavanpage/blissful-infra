import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { loadConfig, type ProjectConfig } from "../utils/config.js";

async function checkDockerRunning(): Promise<boolean> {
  try {
    await execa("docker", ["info"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function startEnvironment(config: ProjectConfig): Promise<void> {
  const spinner = ora("Starting local environment...").start();

  // Check for docker-compose.yaml
  const composeFile = path.join(process.cwd(), "docker-compose.yaml");
  let hasCompose = false;

  try {
    await fs.access(composeFile);
    hasCompose = true;
  } catch {
    // No compose file yet
  }

  if (!hasCompose) {
    spinner.info("No docker-compose.yaml found, generating...");
    await generateDockerCompose(config);
  }

  spinner.text = "Starting containers...";

  try {
    await execa("docker", ["compose", "up", "-d"], {
      stdio: "inherit",
    });

    spinner.succeed("Environment started");

    console.log();
    console.log(chalk.green("Services running:"));

    // Show expected services based on config
    console.log(chalk.dim("  • Application: ") + chalk.cyan("http://localhost:8080"));

    if (config.database === "postgres" || config.database === "postgres-redis") {
      console.log(chalk.dim("  • PostgreSQL:  ") + chalk.cyan("localhost:5432"));
    }

    if (config.database === "redis" || config.database === "postgres-redis") {
      console.log(chalk.dim("  • Redis:       ") + chalk.cyan("localhost:6379"));
    }

    console.log(chalk.dim("  • Kafka:       ") + chalk.cyan("localhost:9092"));

    console.log();
    console.log(chalk.dim("Run"), chalk.cyan("blissful-infra logs"), chalk.dim("to view logs"));
    console.log(chalk.dim("Run"), chalk.cyan("blissful-infra down"), chalk.dim("to stop"));
    console.log();
  } catch (error) {
    spinner.fail("Failed to start environment");
    throw error;
  }
}

async function generateDockerCompose(config: ProjectConfig): Promise<void> {
  const services: Record<string, unknown> = {};

  // Kafka service (KRaft mode - no Zookeeper)
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

  // Application placeholder
  services.app = {
    build: {
      context: ".",
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

  // Build volumes object
  const volumes: Record<string, string | null> = {};
  if (config.database === "postgres" || config.database === "postgres-redis") {
    volumes[`${config.name}-postgres-data`] = null;
  }

  const compose: Record<string, unknown> = { services };
  if (Object.keys(volumes).length > 0) {
    compose.volumes = volumes;
  }

  // Write docker-compose.yaml
  const yaml = generateYaml(compose);
  await fs.writeFile(path.join(process.cwd(), "docker-compose.yaml"), yaml);
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

export const upCommand = new Command("up")
  .description("Start the local development environment")
  .option("-d, --detach", "Run in background", true)
  .action(async () => {
    // Check Docker is running
    if (!(await checkDockerRunning())) {
      console.error(chalk.red("Docker is not running."));
      console.error(chalk.dim("Please start Docker and try again."));
      process.exit(1);
    }

    // Load project config
    const config = await loadConfig();
    if (!config) {
      console.error(chalk.red("No blissful-infra.yaml found."));
      console.error(chalk.dim("Run"), chalk.cyan("blissful-infra create"), chalk.dim("first."));
      process.exit(1);
    }

    await startEnvironment(config);
  });
