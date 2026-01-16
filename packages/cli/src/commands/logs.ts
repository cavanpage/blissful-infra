import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { loadConfig } from "../utils/config.js";

export const logsCommand = new Command("logs")
  .description("View logs from the local environment")
  .option("-f, --follow", "Follow log output", false)
  .option("-n, --tail <lines>", "Number of lines to show", "100")
  .option("-s, --service <name>", "Show logs for specific service")
  .action(async (opts: { follow: boolean; tail: string; service?: string }) => {
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
      console.error(chalk.red("No docker-compose.yaml found."));
      console.error(chalk.dim("Run"), chalk.cyan("blissful-infra up"), chalk.dim("first."));
      process.exit(1);
    }

    const args = ["compose", "logs", `--tail=${opts.tail}`];

    if (opts.follow) {
      args.push("-f");
    }

    if (opts.service) {
      args.push(opts.service);
    }

    try {
      await execa("docker", args, { stdio: "inherit" });
    } catch (error) {
      // User may have pressed Ctrl+C, that's fine
      const execaError = error as { signal?: string };
      if (execaError.signal !== "SIGINT") {
        throw error;
      }
    }
  });
