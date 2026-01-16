import { Command } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

async function promptForOptions(
  providedName?: string,
  providedTemplate?: string
): Promise<ProjectOptions> {
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

  if (!providedTemplate) {
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

  questions.push(
    {
      type: "list",
      name: "database",
      message: "Include database?",
      choices: DATABASES.map((d) => ({
        name: `${d.name.padEnd(15)} ${chalk.dim(`(${d.description})`)}`,
        value: d.name,
      })),
    },
    {
      type: "list",
      name: "deployTarget",
      message: "Deployment target:",
      choices: DEPLOY_TARGETS.map((t) => ({
        name: `${t.name.padEnd(15)} ${chalk.dim(`(${t.description})`)}`,
        value: t.name,
      })),
    }
  );

  const answers = await inquirer.prompt(questions);

  return {
    name: providedName || answers.name,
    template: providedTemplate || answers.template,
    database: answers.database,
    deployTarget: answers.deployTarget,
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

  // Create blissful-infra.yaml config
  const config = {
    name: options.name,
    template: options.template,
    database: options.database,
    deployTarget: options.deployTarget,
    version: "0.1.0",
  };

  await fs.writeFile(
    path.join(projectDir, "blissful-infra.yaml"),
    `# Blissful Infra Configuration
name: ${config.name}
template: ${config.template}
database: ${config.database}
deploy_target: ${config.deployTarget}

# Agent configuration (Phase 1.4)
# agent:
#   provider: ollama
#   model: llama3.1:8b
#   endpoint: http://localhost:11434
`
  );

  // Create placeholder directories
  await fs.mkdir(path.join(projectDir, "src"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "infra"), { recursive: true });

  // Create a basic README
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
\`\`\`

## Configuration

See \`blissful-infra.yaml\` for project settings.

## Template

- **Template:** ${options.template}
- **Database:** ${options.database}
- **Deploy Target:** ${options.deployTarget}
`
  );

  // TODO: Copy actual template files based on options.template
  // For now, create a placeholder note
  await fs.writeFile(
    path.join(projectDir, "src", ".gitkeep"),
    "# Template files will be generated here\n"
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
  .option("-t, --template <template>", "Template to use")
  .action(async (name?: string, opts?: { template?: string }) => {
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

    const options = await promptForOptions(name, opts?.template);
    await scaffoldProject(options);
  });
