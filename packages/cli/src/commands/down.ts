import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { loadConfig } from "../utils/config.js";

export const downCommand = new Command("down")
  .description("Stop the local development environment")
  .option("-v, --volumes", "Also remove volumes", false)
  .action(async (opts: { volumes: boolean }) => {
    // Check for config
    const config = await loadConfig();
    if (!config) {
      console.error(chalk.red("No blissful-infra.yaml found."));
      console.error(chalk.dim("Are you in a blissful-infra project directory?"));
      process.exit(1);
    }

    // Check for docker-compose.yaml
    const composeFile = path.join(process.cwd(), "docker-compose.yaml");
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

      await execa("docker", args, { stdio: "pipe" });

      if (opts.volumes) {
        spinner.succeed("Environment stopped and volumes removed");
      } else {
        spinner.succeed("Environment stopped");
        console.log(chalk.dim("  Run with --volumes to also remove data volumes"));
      }
    } catch (error) {
      spinner.fail("Failed to stop environment");
      throw error;
    }
  });
