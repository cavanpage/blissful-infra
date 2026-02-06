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
import { dashboardCommand } from "./commands/dashboard.js";
// Phase 2 commands
import { deployCommand, deployAction } from "./commands/deploy.js";
import { rollbackCommand, rollbackAction } from "./commands/rollback.js";
import { statusCommand, statusAction } from "./commands/status.js";
import { pipelineCommand, pipelineAction } from "./commands/pipeline.js";

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

// Phase 2 commands (CI/CD and deployment)
program.addCommand(deployCommand);
program.addCommand(rollbackCommand);
program.addCommand(statusCommand);
program.addCommand(pipelineCommand);

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
    const knownCommands = ["start", "create", "up", "down", "logs", "dev", "agent", "dashboard", "deploy", "rollback", "status", "pipeline", "help"];
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

      // Phase 2 commands
      projectProgram
        .command("deploy")
        .description("Deploy to environment via Argo CD")
        .option("-e, --env <environment>", "Target environment", "staging")
        .option("-i, --image <tag>", "Specific image tag to deploy")
        .option("--dry-run", "Show what would be deployed")
        .action(async (opts: { env: string; image?: string; dryRun?: boolean }) => {
          await deployAction(projectName, opts);
        });

      projectProgram
        .command("rollback")
        .description("Rollback to previous deployment")
        .option("-e, --env <environment>", "Target environment", "staging")
        .option("-r, --revision <id>", "Revision to rollback to")
        .option("--dry-run", "Show what would be rolled back")
        .action(async (opts: { env: string; revision?: string; dryRun?: boolean }) => {
          await rollbackAction(projectName, opts);
        });

      projectProgram
        .command("status")
        .description("Show deployment status")
        .action(async () => {
          await statusAction(projectName);
        });

      projectProgram
        .command("pipeline")
        .description("Run CI/CD pipeline locally")
        .option("--local", "Run pipeline locally")
        .option("--push", "Push image to registry")
        .option("--skip-tests", "Skip test stage")
        .option("--skip-scan", "Skip security scan")
        .action(async (opts: { local?: boolean; push?: boolean; skipTests?: boolean; skipScan?: boolean }) => {
          await pipelineAction(projectName, opts);
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
