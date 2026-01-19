import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import { copyTemplate, getAvailableTemplates } from "../utils/template.js";

interface StartOptions {
  backend?: string;
  frontend?: string;
  database?: string;
}

const DEFAULTS = {
  backend: "spring-boot",
  frontend: "react-vite",
  database: "none",
};

async function checkDockerRunning(): Promise<boolean> {
  try {
    await execa("docker", ["info"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function generateDockerCompose(projectDir: string, name: string, database: string): Promise<void> {
  const services: Record<string, unknown> = {};

  // Kafka service
  services.kafka = {
    image: "apache/kafka:3.7.0",
    container_name: `${name}-kafka`,
    hostname: "kafka",
    ports: ["9092:9092", "9094:9094"],
    environment: {
      KAFKA_NODE_ID: 1,
      KAFKA_PROCESS_ROLES: "broker,controller",
      KAFKA_LISTENERS: "PLAINTEXT://0.0.0.0:9094,CONTROLLER://0.0.0.0:9093,EXTERNAL://0.0.0.0:9092",
      KAFKA_ADVERTISED_LISTENERS: "PLAINTEXT://kafka:9094,EXTERNAL://localhost:9092",
      KAFKA_CONTROLLER_QUORUM_VOTERS: "1@kafka:9093",
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,EXTERNAL:PLAINTEXT",
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

  // PostgreSQL
  if (database === "postgres" || database === "postgres-redis") {
    services.postgres = {
      image: "postgres:16-alpine",
      container_name: `${name}-postgres`,
      ports: ["5432:5432"],
      environment: {
        POSTGRES_USER: name.replace(/-/g, "_"),
        POSTGRES_PASSWORD: "localdev",
        POSTGRES_DB: name.replace(/-/g, "_"),
      },
      volumes: [`${name}-postgres-data:/var/lib/postgresql/data`],
      healthcheck: {
        test: ["CMD-SHELL", `pg_isready -U ${name.replace(/-/g, "_")}`],
        interval: "5s",
        timeout: "3s",
        retries: 5,
      },
    };
  }

  // Redis
  if (database === "redis" || database === "postgres-redis") {
    services.redis = {
      image: "redis:7-alpine",
      container_name: `${name}-redis`,
      ports: ["6379:6379"],
      healthcheck: {
        test: ["CMD", "redis-cli", "ping"],
        interval: "5s",
        timeout: "3s",
        retries: 5,
      },
    };
  }

  // Backend app
  services.app = {
    build: {
      context: "./backend",
      dockerfile: "Dockerfile",
    },
    container_name: `${name}-app`,
    ports: ["8080:8080"],
    environment: {
      KAFKA_BOOTSTRAP_SERVERS: "kafka:9094",
      ...(database === "postgres" || database === "postgres-redis"
        ? { DATABASE_URL: `postgresql://${name.replace(/-/g, "_")}:localdev@postgres:5432/${name.replace(/-/g, "_")}` }
        : {}),
      ...(database === "redis" || database === "postgres-redis"
        ? { REDIS_URL: "redis://redis:6379" }
        : {}),
    },
    depends_on: {
      kafka: { condition: "service_healthy" },
      ...(database === "postgres" || database === "postgres-redis"
        ? { postgres: { condition: "service_healthy" } }
        : {}),
      ...(database === "redis" || database === "postgres-redis"
        ? { redis: { condition: "service_healthy" } }
        : {}),
    },
  };

  // Frontend
  services.frontend = {
    build: {
      context: "./frontend",
      dockerfile: "Dockerfile",
    },
    container_name: `${name}-frontend`,
    ports: ["3000:80"],
    depends_on: ["app"],
  };

  // Build volumes object
  const volumes: Record<string, null> = {};
  if (database === "postgres" || database === "postgres-redis") {
    volumes[`${name}-postgres-data`] = null;
  }

  const compose: Record<string, unknown> = { services };
  if (Object.keys(volumes).length > 0) {
    compose.volumes = volumes;
  }

  const yaml = generateYaml(compose);
  await fs.writeFile(path.join(projectDir, "docker-compose.yaml"), yaml);
}

function generateYaml(obj: unknown, indent = 0): string {
  const spaces = "  ".repeat(indent);

  if (obj === null) return "";
  if (obj === undefined) return "null";

  if (typeof obj === "string") {
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

export const startCommand = new Command("start")
  .description("Create and run a fullstack app in one command")
  .argument("<name>", "Project name")
  .option("-b, --backend <backend>", `Backend framework (default: ${DEFAULTS.backend})`)
  .option("-f, --frontend <frontend>", `Frontend framework (default: ${DEFAULTS.frontend})`)
  .option("-d, --database <database>", `Database (none, postgres, redis, postgres-redis)`)
  .action(async (name: string, opts: StartOptions) => {
    console.log();
    console.log(chalk.bold("⚡ blissful-infra start"), chalk.dim("- Create and run fullstack app"));
    console.log();

    // Validate name
    if (!/^[a-z0-9-]+$/.test(name)) {
      console.error(chalk.red("Project name must be lowercase alphanumeric with hyphens"));
      process.exit(1);
    }

    // Check Docker first
    if (!(await checkDockerRunning())) {
      console.error(chalk.red("Docker is not running."));
      console.error(chalk.dim("Please start Docker and try again."));
      process.exit(1);
    }

    const backend = opts.backend || DEFAULTS.backend;
    const frontend = opts.frontend || DEFAULTS.frontend;
    const database = opts.database || DEFAULTS.database;

    const projectDir = path.resolve(process.cwd(), name);

    // Check if directory exists
    try {
      await fs.access(projectDir);
      console.error(chalk.red(`Directory ${name} already exists`));
      process.exit(1);
    } catch {
      // Good - doesn't exist
    }

    const availableTemplates = getAvailableTemplates();

    // Step 1: Scaffold
    const scaffoldSpinner = ora("Creating fullstack project...").start();

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(path.join(projectDir, "backend"), { recursive: true });
    await fs.mkdir(path.join(projectDir, "frontend"), { recursive: true });

    // Copy backend
    if (availableTemplates.includes(backend)) {
      scaffoldSpinner.text = `Copying ${backend} backend...`;
      await copyTemplate(backend, path.join(projectDir, "backend"), {
        projectName: name,
        database,
        deployTarget: "local-only",
      });
    } else {
      scaffoldSpinner.warn(`Backend '${backend}' not yet available, using placeholder`);
      await fs.writeFile(path.join(projectDir, "backend", ".gitkeep"), `# ${backend} coming soon\n`);
    }

    // Copy frontend
    if (availableTemplates.includes(frontend)) {
      scaffoldSpinner.text = `Copying ${frontend} frontend...`;
      await copyTemplate(frontend, path.join(projectDir, "frontend"), {
        projectName: name,
        database,
        deployTarget: "local-only",
      });
    } else {
      scaffoldSpinner.warn(`Frontend '${frontend}' not yet available, using placeholder`);
      await fs.writeFile(path.join(projectDir, "frontend", ".gitkeep"), `# ${frontend} coming soon\n`);
    }

    // Create config
    await fs.writeFile(
      path.join(projectDir, "blissful-infra.yaml"),
      `# Blissful Infra Configuration
name: ${name}
type: fullstack
backend: ${backend}
frontend: ${frontend}
database: ${database}
deploy_target: local-only
`
    );

    // Create .gitignore
    await fs.writeFile(
      path.join(projectDir, ".gitignore"),
      `node_modules/
dist/
build/
.gradle/
target/
.idea/
.vscode/
.env
.env.local
.DS_Store
docker-compose.override.yaml
`
    );

    scaffoldSpinner.succeed(`Created ${name}/`);

    // Step 2: Generate docker-compose
    const composeSpinner = ora("Generating docker-compose.yaml...").start();
    await generateDockerCompose(projectDir, name, database);
    composeSpinner.succeed("Generated docker-compose.yaml");

    // Step 3: Start containers
    const startSpinner = ora("Building and starting containers...").start();

    try {
      await execa("docker", ["compose", "up", "-d", "--build"], {
        cwd: projectDir,
        stdio: "pipe",
      });
      startSpinner.succeed("Containers started");
    } catch (error) {
      startSpinner.fail("Failed to start containers");
      if (error instanceof Error && "stderr" in error) {
        console.error(chalk.red((error as { stderr: string }).stderr));
      }
      console.log();
      console.log(chalk.yellow("Project created but failed to start. Try:"));
      console.log(chalk.cyan(`  cd ${name}`));
      console.log(chalk.cyan("  docker compose up --build"));
      process.exit(1);
    }

    // Success!
    console.log();
    console.log(chalk.green.bold("✓ Your fullstack app is running!"));
    console.log();
    console.log(chalk.dim("  Frontend:    ") + chalk.cyan("http://localhost:3000"));
    console.log(chalk.dim("  Backend API: ") + chalk.cyan("http://localhost:8080"));
    console.log(chalk.dim("  Kafka:       ") + chalk.cyan("localhost:9092"));
    if (database === "postgres" || database === "postgres-redis") {
      console.log(chalk.dim("  PostgreSQL:  ") + chalk.cyan("localhost:5432"));
    }
    if (database === "redis" || database === "postgres-redis") {
      console.log(chalk.dim("  Redis:       ") + chalk.cyan("localhost:6379"));
    }
    console.log();
    console.log(chalk.dim("Commands:"));
    console.log(chalk.dim("  cd ") + chalk.cyan(name));
    console.log(chalk.dim("  blissful-infra logs     ") + chalk.dim("# View logs"));
    console.log(chalk.dim("  blissful-infra dev      ") + chalk.dim("# Hot reload mode"));
    console.log(chalk.dim("  blissful-infra down     ") + chalk.dim("# Stop everything"));
    console.log();
  });
