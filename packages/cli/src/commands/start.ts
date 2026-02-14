import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { copyTemplate, linkTemplate, getAvailableTemplates } from "../utils/template.js";
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

interface StartOptions {
  backend?: string;
  frontend?: string;
  database?: string;
  link?: boolean;
  plugins?: string;
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

async function generateDockerCompose(projectDir: string, name: string, database: string, plugins: string[] = []): Promise<void> {
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

  // Nginx reverse proxy
  services.nginx = {
    image: "nginx:alpine",
    container_name: `${name}-nginx`,
    ports: ["80:80"],
    volumes: ["./nginx.conf:/etc/nginx/conf.d/default.conf:ro"],
    depends_on: ["app", "frontend"],
  };

  // Generate nginx.conf
  await generateNginxConf(projectDir);

  // AI Pipeline plugin
  if (plugins.includes("ai-pipeline")) {
    services["ai-pipeline"] = {
      build: {
        context: "./ai-pipeline",
        dockerfile: "Dockerfile",
      },
      container_name: `${name}-ai-pipeline`,
      ports: ["8090:8090"],
      environment: {
        PROJECT_NAME: name,
        KAFKA_BOOTSTRAP_SERVERS: "kafka:9094",
        PIPELINE_MODE: "streaming",
        SPARK_MASTER: "local[*]",
      },
      depends_on: {
        kafka: { condition: "service_healthy" },
      },
    };
  }

  // Dashboard service
  services.dashboard = {
    image: "blissful-infra-dashboard:latest",
    container_name: `${name}-dashboard`,
    ports: ["3002:3002"],
    environment: {
      PROJECTS_DIR: "/projects",
      DASHBOARD_DIST_DIR: "/app/dashboard-dist",
      DASHBOARD_PORT: "3002",
      DOCKER_MODE: "true",
    },
    volumes: [
      "/var/run/docker.sock:/var/run/docker.sock",
      `.:/projects/${name}`,
    ],
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

async function generateNginxConf(projectDir: string): Promise<void> {
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

  const defaultLocation = `    location / {
        proxy_pass http://frontend:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }`;

  const serverBlock = `server {
    listen 80;
    server_name localhost;

${locationBlocks}

${wsBlock}

${defaultLocation}
}`;

  await fs.writeFile(path.join(projectDir, "nginx.conf"), serverBlock + "\n");
}

export const startCommand = new Command("start")
  .description("Create and run a fullstack app in one command")
  .argument("<name>", "Project name")
  .option("-b, --backend <backend>", `Backend framework (default: ${DEFAULTS.backend})`)
  .option("-f, --frontend <frontend>", `Frontend framework (default: ${DEFAULTS.frontend})`)
  .option("-d, --database <database>", `Database (none, postgres, redis, postgres-redis)`)
  .option("-l, --link", "Link to templates instead of copying (for template development)")
  .option("-p, --plugins <plugins>", "Comma-separated plugins (e.g. ai-pipeline)")
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
    const linkMode = opts.link || false;
    const plugins = opts.plugins ? opts.plugins.split(",").map(p => p.trim()) : [];

    // Check for port conflicts before creating anything
    const requiredPorts = getRequiredPorts({ type: "fullstack", database, plugins: plugins.join(",") });
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

    if (linkMode) {
      // Link mode: create symlinks to template directories
      scaffoldSpinner.text = `Linking ${backend} backend...`;
      if (availableTemplates.includes(backend)) {
        await linkTemplate(backend, path.join(projectDir, "backend"));
      } else {
        await fs.mkdir(path.join(projectDir, "backend"), { recursive: true });
        scaffoldSpinner.warn(`Backend '${backend}' not yet available, using placeholder`);
        await fs.writeFile(path.join(projectDir, "backend", ".gitkeep"), `# ${backend} coming soon\n`);
      }

      scaffoldSpinner.text = `Linking ${frontend} frontend...`;
      if (availableTemplates.includes(frontend)) {
        await linkTemplate(frontend, path.join(projectDir, "frontend"));
      } else {
        await fs.mkdir(path.join(projectDir, "frontend"), { recursive: true });
        scaffoldSpinner.warn(`Frontend '${frontend}' not yet available, using placeholder`);
        await fs.writeFile(path.join(projectDir, "frontend", ".gitkeep"), `# ${frontend} coming soon\n`);
      }
    } else {
      // Normal mode: copy template files
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
    }

    // Copy plugin templates
    for (const plugin of plugins) {
      if (availableTemplates.includes(plugin)) {
        scaffoldSpinner.text = `Copying ${plugin} plugin...`;
        const pluginDir = path.join(projectDir, plugin);
        await fs.mkdir(pluginDir, { recursive: true });
        await copyTemplate(plugin, pluginDir, {
          projectName: name,
          database,
          deployTarget: "local-only",
        });
      }
    }

    // Create config
    const configLines = [
      "# Blissful Infra Configuration",
      `name: ${name}`,
      "type: fullstack",
      `backend: ${backend}`,
      `frontend: ${frontend}`,
      `database: ${database}`,
      "deploy_target: local-only",
    ];
    if (plugins.length > 0) {
      configLines.push(`plugins: ${plugins.join(",")}`);
    }
    await fs.writeFile(
      path.join(projectDir, "blissful-infra.yaml"),
      configLines.join("\n") + "\n"
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

    if (linkMode) {
      scaffoldSpinner.succeed(`Created ${name}/ (linked to templates)`);
    } else {
      scaffoldSpinner.succeed(`Created ${name}/`);
    }

    // Step 2: Generate docker-compose
    const composeSpinner = ora("Generating docker-compose.yaml...").start();
    await generateDockerCompose(projectDir, name, database, plugins);
    composeSpinner.succeed("Generated docker-compose.yaml");

    // Step 3: Build dashboard image and start containers
    await ensureDashboardImage();
    const startSpinner = ora("Building and starting containers...").start();

    try {
      await execa("docker", ["compose", "up", "-d", "--build"], {
        cwd: projectDir,
        stdio: "pipe",
      });
      startSpinner.succeed("Containers started");
    } catch (error) {
      startSpinner.fail("Failed to start containers");
      const execError = toExecError(error);
      if (execError.stderr) {
        console.error(chalk.red(execError.stderr));
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
    if (linkMode) {
      console.log(chalk.yellow("  (Link mode: editing templates will affect this project)"));
    }
    console.log();
    console.log(chalk.dim("  Frontend:    ") + chalk.cyan("http://localhost:3000"));
    console.log(chalk.dim("  Backend API: ") + chalk.cyan("http://localhost:8080"));
    console.log(chalk.dim("  Nginx:       ") + chalk.cyan("http://localhost"));
    console.log(chalk.dim("  Kafka:       ") + chalk.cyan("localhost:9092"));
    if (database === "postgres" || database === "postgres-redis") {
      console.log(chalk.dim("  PostgreSQL:  ") + chalk.cyan("localhost:5432"));
    }
    if (database === "redis" || database === "postgres-redis") {
      console.log(chalk.dim("  Redis:       ") + chalk.cyan("localhost:6379"));
    }
    if (plugins.includes("ai-pipeline")) {
      console.log(chalk.dim("  AI Pipeline: ") + chalk.cyan("http://localhost:8090"));
    }
    console.log(chalk.dim("  Dashboard:   ") + chalk.cyan("http://localhost:3002"));
    console.log();
    console.log(chalk.dim("Commands:"));
    console.log(chalk.dim("  cd ") + chalk.cyan(name));
    console.log(chalk.dim("  blissful-infra logs     ") + chalk.dim("# View logs"));
    console.log(chalk.dim("  blissful-infra dev      ") + chalk.dim("# Hot reload mode"));
    console.log(chalk.dim("  blissful-infra down     ") + chalk.dim("# Stop everything"));
    console.log();
  });
