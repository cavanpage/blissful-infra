import { Command } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import fs from "node:fs/promises";
import { copyTemplate, getAvailableTemplates } from "../utils/template.js";

interface ProjectOptions {
  name: string;
  template: string;
  database: string;
  deployTarget: string;
}

const TEMPLATES = [
  {
    name: "spring-boot",
    description: "Kotlin + Spring Boot + Kafka + WebSockets",
  },
  { name: "fastapi", description: "Python + FastAPI + Kafka + WebSockets" },
  {
    name: "express",
    description: "Node + Express + TypeScript + Kafka + WebSockets",
  },
  { name: "go-chi", description: "Go + Chi router + Kafka + WebSockets" },
  {
    name: "react-vite",
    description: "React + Vite + TypeScript + Redux + shadcn/ui",
  },
  { name: "fullstack", description: "Backend + Frontend monorepo" },
] as const;

const DATABASES = [
  { name: "none", description: "No database" },
  { name: "postgres", description: "PostgreSQL" },
  { name: "redis", description: "Redis" },
  { name: "postgres-redis", description: "PostgreSQL + Redis" },
] as const;

const DEPLOY_TARGETS = [
  { name: "local-only", description: "Docker Compose" },
  { name: "kubernetes", description: "Argo CD + Kind for local" },
  { name: "cloud", description: "EKS/GKE/AKS" },
] as const;

interface CommandOptions {
  template?: string;
  database?: string;
  deploy?: string;
}

async function promptForOptions(
  providedName?: string,
  opts?: CommandOptions
): Promise<ProjectOptions> {
  // If all options provided via CLI, skip prompts
  if (providedName && opts?.template && opts?.database && opts?.deploy) {
    return {
      name: providedName,
      template: opts.template,
      database: opts.database,
      deployTarget: opts.deploy,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const questions: any[] = [];

  if (!providedName) {
    questions.push({
      type: "input",
      name: "name",
      message: "Project name:",
      default: "my-service",
      validate: (input: string) => {
        if (!input.trim()) return "Project name is required";
        if (!/^[a-z0-9-]+$/.test(input))
          return "Project name must be lowercase alphanumeric with hyphens";
        return true;
      },
    });
  }

  if (!opts?.template) {
    questions.push({
      type: "list",
      name: "template",
      message: "Select template:",
      choices: TEMPLATES.map((t) => ({
        name: `${t.name.padEnd(12)} ${chalk.dim(`(${t.description})`)}`,
        value: t.name,
      })),
    });
  }

  if (!opts?.database) {
    questions.push({
      type: "list",
      name: "database",
      message: "Include database?",
      choices: DATABASES.map((d) => ({
        name: `${d.name.padEnd(15)} ${chalk.dim(`(${d.description})`)}`,
        value: d.name,
      })),
    });
  }

  if (!opts?.deploy) {
    questions.push({
      type: "list",
      name: "deployTarget",
      message: "Deployment target:",
      choices: DEPLOY_TARGETS.map((t) => ({
        name: `${t.name.padEnd(15)} ${chalk.dim(`(${t.description})`)}`,
        value: t.name,
      })),
    });
  }

  const answers = questions.length > 0 ? await inquirer.prompt(questions) : {};

  return {
    name: providedName || answers.name,
    template: opts?.template || answers.template,
    database: opts?.database || answers.database,
    deployTarget: opts?.deploy || answers.deployTarget,
  };
}

async function scaffoldProject(options: ProjectOptions): Promise<void> {
  const spinner = ora(`Scaffolding project in ./${options.name}...`).start();

  const projectDir = path.resolve(process.cwd(), options.name);

  // Check if directory exists
  try {
    await fs.access(projectDir);
    spinner.fail(`Directory ${options.name} already exists`);
    process.exit(1);
  } catch {
    // Directory doesn't exist, good to proceed
  }

  // Create project directory
  await fs.mkdir(projectDir, { recursive: true });

  // Copy template files
  const availableTemplates = getAvailableTemplates();
  if (availableTemplates.includes(options.template)) {
    spinner.text = `Copying ${options.template} template...`;
    await copyTemplate(options.template, projectDir, {
      projectName: options.name,
      database: options.database,
      deployTarget: options.deployTarget,
    });
  } else {
    // Template not yet implemented, create placeholder
    await fs.mkdir(path.join(projectDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "src", ".gitkeep"),
      `# Template '${options.template}' coming soon\n`
    );
  }

  // Create blissful-infra.yaml config
  await fs.writeFile(
    path.join(projectDir, "blissful-infra.yaml"),
    `# Blissful Infra Configuration
name: ${options.name}
template: ${options.template}
database: ${options.database}
deploy_target: ${options.deployTarget}

# Agent configuration (Phase 1.4)
# agent:
#   provider: ollama
#   model: llama3.1:8b
#   endpoint: http://localhost:11434
`
  );

  // Create README
  await fs.writeFile(
    path.join(projectDir, "README.md"),
    `# ${options.name}

Generated with [blissful-infra](https://github.com/you/blissful-infra).

## Quick Start

\`\`\`bash
# Start local environment
blissful-infra up

# View logs
blissful-infra logs

# Stop environment
blissful-infra down

# Test the API
curl http://localhost:8080/health
curl http://localhost:8080/hello
curl http://localhost:8080/hello/YourName
\`\`\`

## Configuration

See \`blissful-infra.yaml\` for project settings.

## Template

- **Template:** ${options.template}
- **Database:** ${options.database}
- **Deploy Target:** ${options.deployTarget}

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| \`/health\` | GET | Health check |
| \`/ready\` | GET | Kubernetes readiness probe |
| \`/live\` | GET | Kubernetes liveness probe |
| \`/hello\` | GET | Returns "Hello, World!" |
| \`/hello/:name\` | GET | Returns personalized greeting |
| \`/echo\` | POST | Echoes request body |
| \`/ws/events\` | WS | WebSocket for real-time events |
`
  );

  spinner.succeed(`Scaffolded project in ./${options.name}`);

  console.log();
  console.log(chalk.green("Done!"), "Now run:");
  console.log();
  console.log(chalk.cyan(`  cd ${options.name}`));
  console.log(chalk.cyan("  blissful-infra up"));
  console.log();
}

export const createCommand = new Command("create")
  .description("Create a new blissful-infra project")
  .argument("[name]", "Project name")
  .option("-t, --template <template>", "Template to use (spring-boot, fastapi, express, go-chi, react-vite, fullstack)")
  .option("-d, --database <database>", "Database to include (none, postgres, redis, postgres-redis)")
  .option("--deploy <target>", "Deployment target (local-only, kubernetes, cloud)")
  .action(async (name?: string, opts?: CommandOptions) => {
    console.log();
    console.log(
      chalk.bold("⚡ blissful-infra"),
      chalk.dim("- Infrastructure that thinks for itself")
    );
    console.log();

    // Validate template if provided
    if (opts?.template) {
      const validTemplates = TEMPLATES.map((t) => t.name);
      if (!validTemplates.includes(opts.template as (typeof TEMPLATES)[number]["name"])) {
        console.error(
          chalk.red(`Invalid template: ${opts.template}`),
          chalk.dim(`\nValid templates: ${validTemplates.join(", ")}`)
        );
        process.exit(1);
      }
    }

    // Validate database if provided
    if (opts?.database) {
      const validDatabases = DATABASES.map((d) => d.name);
      if (!validDatabases.includes(opts.database as (typeof DATABASES)[number]["name"])) {
        console.error(
          chalk.red(`Invalid database: ${opts.database}`),
          chalk.dim(`\nValid databases: ${validDatabases.join(", ")}`)
        );
        process.exit(1);
      }
    }

    // Validate deploy target if provided
    if (opts?.deploy) {
      const validTargets = DEPLOY_TARGETS.map((t) => t.name);
      if (!validTargets.includes(opts.deploy as (typeof DEPLOY_TARGETS)[number]["name"])) {
        console.error(
          chalk.red(`Invalid deploy target: ${opts.deploy}`),
          chalk.dim(`\nValid targets: ${validTargets.join(", ")}`)
        );
        process.exit(1);
      }
    }

    const options = await promptForOptions(name, opts);
    await scaffoldProject(options);
  });
