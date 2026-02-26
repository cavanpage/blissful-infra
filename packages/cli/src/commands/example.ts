import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { copyTemplate, copyPlugin } from "../utils/template.js";
import { parsePluginSpecs, type PluginInstance } from "../utils/config.js";
import { generateDockerCompose } from "./start.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// examples/ lives at packages/cli/examples/ (2 levels up from dist/commands/)
const EXAMPLES_DIR = path.join(__dirname, "..", "..", "examples");

interface ExampleMeta {
  displayName: string;
  description: string;
  backend: string;
  frontend: string;
  database: string;
  plugins: string[];
  tags: string[];
}

async function loadExampleMeta(name: string): Promise<ExampleMeta | null> {
  const metaPath = path.join(EXAMPLES_DIR, name, "example.json");
  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    return JSON.parse(raw) as ExampleMeta;
  } catch {
    return null;
  }
}

async function getAvailableExamples(): Promise<string[]> {
  try {
    const entries = await fs.readdir(EXAMPLES_DIR, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    const valid: string[] = [];
    for (const dir of dirs) {
      const meta = await loadExampleMeta(dir);
      if (meta) valid.push(dir);
    }
    return valid;
  } catch {
    return [];
  }
}

async function listExamples(): Promise<void> {
  const names = await getAvailableExamples();
  if (names.length === 0) {
    console.log(chalk.yellow("No examples found."));
    return;
  }
  console.log(chalk.bold("\nAvailable examples:\n"));
  for (const name of names) {
    const meta = await loadExampleMeta(name);
    if (!meta) continue;
    console.log(`  ${chalk.cyan(name)}`);
    console.log(`    ${meta.description}`);
    console.log(
      `    Stack: ${chalk.gray([meta.backend, meta.frontend, ...meta.plugins].join(", "))}`
    );
    console.log(`    Tags:  ${chalk.gray(meta.tags.join(", "))}\n`);
  }
  console.log(`Run ${chalk.cyan("blissful-infra example <name>")} to scaffold one.\n`);
}

async function scaffoldExample(name: string, outputBase: string): Promise<void> {
  // Validate example exists
  const meta = await loadExampleMeta(name);
  if (!meta) {
    const available = await getAvailableExamples();
    console.error(chalk.red(`Example '${name}' not found.`));
    if (available.length > 0) {
      console.error(`Available: ${available.map((n) => chalk.cyan(n)).join(", ")}`);
    }
    process.exit(1);
  }

  const projectDir = path.join(outputBase, name);

  // Check if directory already exists
  try {
    await fs.access(projectDir);
    console.error(chalk.red(`Directory '${projectDir}' already exists.`));
    process.exit(1);
  } catch {
    // good — doesn't exist yet
  }

  const spinner = ora(`Scaffolding ${chalk.cyan(meta.displayName)}...`).start();

  try {
    // 1. Create project directory
    await fs.mkdir(projectDir, { recursive: true });

    const templateVars = {
      projectName: name,
      database: meta.database,
      deployTarget: "local-only",
    };

    // 2. Copy backend template
    spinner.text = `Copying ${meta.backend} backend...`;
    await copyTemplate(meta.backend, path.join(projectDir, "backend"), templateVars);

    // 3. Copy frontend template
    spinner.text = `Copying ${meta.frontend} frontend...`;
    await copyTemplate(meta.frontend, path.join(projectDir, "frontend"), templateVars);

    // 4. Copy base plugin templates + overlay example-specific overrides
    const pluginInstances: PluginInstance[] = parsePluginSpecs(meta.plugins);
    for (const plugin of pluginInstances) {
      const pluginDestDir = path.join(projectDir, plugin.instance);
      await fs.mkdir(pluginDestDir, { recursive: true });

      spinner.text = `Copying ${plugin.type} plugin template...`;
      await copyPlugin(plugin.type, pluginDestDir, {
        ...templateVars,
        instanceName: plugin.instance,
        apiPort: 8090,
      });

      // Overlay example-specific overrides on top of the base plugin
      const overrideDir = path.join(EXAMPLES_DIR, name, plugin.type);
      try {
        await fs.access(overrideDir);
        spinner.text = `Applying ${name} overrides to ${plugin.type}...`;
        await fs.cp(overrideDir, pluginDestDir, { recursive: true, force: true });
      } catch {
        // No overrides for this plugin — base template is used as-is
      }
    }

    // 5. Write blissful-infra.yaml
    const pluginYaml = pluginInstances
      .map((p) => `  - type: ${p.type}`)
      .join("\n");
    const configYaml = [
      `project: ${name}`,
      `backend: ${meta.backend}`,
      `frontend: ${meta.frontend}`,
      `database: ${meta.database}`,
      `deploy_target: local-only`,
      pluginInstances.length > 0 ? `plugins:\n${pluginYaml}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await fs.writeFile(path.join(projectDir, "blissful-infra.yaml"), configYaml + "\n");

    // 6. Generate docker-compose.yaml
    spinner.text = "Generating docker-compose.yaml...";
    await generateDockerCompose(projectDir, name, meta.database, pluginInstances);

    // 7. Write .gitignore
    const gitignore = [
      "node_modules/",
      ".gradle/",
      "build/",
      "*.class",
      "__pycache__/",
      "*.pyc",
      ".env",
    ].join("\n");
    await fs.writeFile(path.join(projectDir, ".gitignore"), gitignore + "\n");

    spinner.succeed(`${chalk.green("✓")} ${chalk.bold(meta.displayName)} scaffolded`);
  } catch (error) {
    spinner.fail("Scaffolding failed");
    // Clean up partial directory
    await fs.rm(projectDir, { recursive: true, force: true });
    throw error;
  }

  // Print next steps
  console.log(`\n  ${chalk.bold("Project:")}  ${projectDir}`);
  console.log(`  ${chalk.bold("Backend:")}  ${meta.backend}`);
  console.log(`  ${chalk.bold("Plugins:")}  ${meta.plugins.join(", ")}\n`);

  console.log(chalk.bold("Services (after starting):\n"));
  console.log(`  Frontend    http://localhost:3000`);
  console.log(`  Backend     http://localhost:8080`);
  if (meta.plugins.includes("ai-pipeline")) {
    console.log(`  AI Pipeline http://localhost:8090/docs`);
    console.log(`  ClickHouse  http://localhost:8123/play`);
    console.log(`  MLflow      http://localhost:5001`);
    console.log(`  Mage        http://localhost:6789`);
  }
  console.log(`  Dashboard   http://localhost:3002\n`);

  console.log(chalk.bold("Next steps:\n"));
  console.log(`  ${chalk.cyan(`cd ${name}`)}`);
  console.log(`  ${chalk.cyan("blissful-infra up")}\n`);

  if (meta.tags.length > 0) {
    console.log(
      `  ${chalk.gray("Read the example guide:")} ${chalk.underline(path.join(projectDir, "README.md"))}\n`
    );
  }
}

// ------------------------------------------------------------------ #
// Command definition                                                   #
// ------------------------------------------------------------------ #

const listSubcommand = new Command("list")
  .description("List available example projects")
  .action(async () => {
    await listExamples();
  });

export const exampleCommand = new Command("example")
  .description("Scaffold a reference example project")
  .addCommand(listSubcommand)
  .argument("[name]", "Example name (e.g. content-recommender)")
  .option("-o, --output <dir>", "Output directory", process.cwd())
  .action(async (name: string | undefined, opts: { output: string }) => {
    if (!name) {
      await listExamples();
      return;
    }
    await scaffoldExample(name, opts.output);
  });
