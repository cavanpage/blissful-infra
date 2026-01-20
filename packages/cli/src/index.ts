#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import { createCommand } from "./commands/create.js";
import { startCommand } from "./commands/start.js";
import { upCommand, upAction } from "./commands/up.js";
import { downCommand, downAction } from "./commands/down.js";
import { logsCommand, logsAction } from "./commands/logs.js";
import { devCommand } from "./commands/dev.js";
import { agentCommand, agentAction } from "./commands/agent.js";
import { dashboardCommand, dashboardAction } from "./commands/dashboard.js";

const program = new Command();

program
  .name("blissful-infra")
  .description("Infrastructure that thinks for itself")
  .version("0.1.0");

// Global commands (don't require a project)
program.addCommand(startCommand);
program.addCommand(createCommand);

// Legacy commands (also work from project directory or with name arg)
program.addCommand(upCommand);
program.addCommand(downCommand);
program.addCommand(logsCommand);
program.addCommand(devCommand);
program.addCommand(agentCommand);
program.addCommand(dashboardCommand);

// Check if first arg is a project directory for project-first syntax
async function isProjectDir(name: string): Promise<boolean> {
  try {
    const projectDir = path.join(process.cwd(), name);
    await fs.access(path.join(projectDir, "blissful-infra.yaml"));
    return true;
  } catch {
    return false;
  }
}

// Handle project-first syntax: blissful-infra <project> <command>
async function main() {
  const args = process.argv.slice(2);

  // If first arg could be a project name (not a known command or flag)
  if (args.length >= 1 && !args[0].startsWith("-")) {
    const knownCommands = ["start", "create", "up", "down", "logs", "dev", "agent", "dashboard", "help"];
    const firstArg = args[0];

    if (!knownCommands.includes(firstArg) && await isProjectDir(firstArg)) {
      const projectName = firstArg;
      const subCommand = args[1];
      const remainingArgs = args.slice(2);

      // Create a project-specific command group
      const projectProgram = new Command(projectName);
      projectProgram.description(`Commands for project '${projectName}'`);

      // Add project-scoped commands
      projectProgram
        .command("up")
        .description("Start the local development environment")
        .option("-d, --detach", "Run in background", true)
        .action(async () => {
          await upAction(projectName);
        });

      projectProgram
        .command("down")
        .description("Stop the local development environment")
        .option("-v, --volumes", "Remove volumes too")
        .action(async (opts: { volumes?: boolean }) => {
          await downAction(projectName, opts);
        });

      projectProgram
        .command("logs")
        .description("View logs from the local environment")
        .option("-f, --follow", "Follow log output")
        .option("-n, --lines <number>", "Number of lines to show", "100")
        .option("-s, --service <name>", "Show logs for specific service")
        .action(async (opts: { follow?: boolean; lines?: string; service?: string }) => {
          await logsAction(projectName, opts);
        });

      projectProgram
        .command("agent")
        .description("AI-powered infrastructure assistant")
        .option("-q, --query <query>", "Single query mode (non-interactive)")
        .option("-m, --model <model>", "Override model selection")
        .action(async (opts: { query?: string; model?: string }) => {
          await agentAction(projectName, opts);
        });

      projectProgram
        .command("dashboard")
        .description("Open the web dashboard")
        .option("-p, --port <port>", "API server port", "3002")
        .option("--no-open", "Don't open browser automatically")
        .action(async (opts: { port: string; open: boolean }) => {
          await dashboardAction(projectName, opts);
        });

      // Parse project-specific command
      if (subCommand) {
        projectProgram.parse(["node", "blissful-infra", subCommand, ...remainingArgs]);
      } else {
        projectProgram.outputHelp();
      }
      return;
    }
  }

  // Fall back to standard parsing
  program.parse();
}

main().catch(console.error);
