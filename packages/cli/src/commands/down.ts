import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { loadConfig } from "../utils/config.js";

async function findProjectDir(name?: string): Promise<string | null> {
  // If name provided, look for that directory
  if (name) {
    const projectDir = path.join(process.cwd(), name);
    try {
      await fs.access(path.join(projectDir, "blissful-infra.yaml"));
      return projectDir;
    } catch {
      return null;
    }
  }

  // Check current directory
  try {
    await fs.access(path.join(process.cwd(), "blissful-infra.yaml"));
    return process.cwd();
  } catch {
    return null;
  }
}

export async function downAction(name?: string, opts: { volumes?: boolean } = {}): Promise<void> {
  // Find the project directory
  const projectDir = await findProjectDir(name);

  if (!projectDir) {
    if (name) {
      console.error(chalk.red(`Project '${name}' not found.`));
      console.error(chalk.dim(`No blissful-infra.yaml in ./${name}/`));
    } else {
      console.error(chalk.red("No blissful-infra.yaml found."));
      console.error(chalk.dim("Run from project directory or specify project name:"));
      console.error(chalk.cyan("  blissful-infra down my-app"));
    }
    process.exit(1);
  }

  // Check for docker-compose.yaml
  const composeFile = path.join(projectDir, "docker-compose.yaml");
  try {
    await fs.access(composeFile);
  } catch {
    console.log(chalk.yellow("No docker-compose.yaml found. Nothing to stop."));
    return;
  }

  const spinner = ora("Stopping environment...").start();

  try {
    const args = ["compose", "down"];
    if (opts.volumes) {
      args.push("-v");
    }

    await execa("docker", args, { cwd: projectDir, stdio: "pipe" });

    if (opts.volumes) {
      spinner.succeed("Environment stopped and volumes removed");
    } else {
      spinner.succeed("Environment stopped");
      console.log(chalk.dim("  Run with --volumes to also remove data volumes"));
    }
  } catch (error) {
    spinner.fail("Failed to stop environment");
    const execaError = error as { stderr?: string };
    if (execaError.stderr?.includes("Cannot connect to the Docker daemon")) {
      console.error(chalk.red("Docker is not running."));
      console.error(chalk.dim("Please start Docker and try again."));
    } else if (execaError.stderr) {
      console.error(chalk.red(execaError.stderr));
    }
    process.exit(1);
  }
}

export const downCommand = new Command("down")
  .description("Stop the local development environment")
  .argument("[name]", "Project name (if running from parent directory)")
  .option("-v, --volumes", "Also remove volumes", false)
  .action(async (name: string | undefined, opts: { volumes: boolean }) => {
    await downAction(name, opts);
  });
