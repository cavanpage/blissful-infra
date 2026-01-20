import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { createApiServer } from "../server/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      await execa("open", [url]);
    } else if (platform === "win32") {
      await execa("cmd", ["/c", "start", url]);
    } else {
      await execa("xdg-open", [url]);
    }
  } catch {
    // Silently fail if can't open browser
  }
}

export async function dashboardAction(opts: { port?: string; open?: boolean; dir?: string } = {}): Promise<void> {
  // Use provided directory or current working directory
  const workingDir = opts.dir || process.cwd();

  const apiPort = parseInt(opts.port || "3002", 10);
  const dashboardPort = 3001;
  const shouldOpen = opts.open !== false;

  // Start API server
  const spinner = ora("Starting dashboard...").start();

  const apiServer = createApiServer(workingDir, apiPort);
  await apiServer.start();

  spinner.succeed("Dashboard ready");

  console.log();
  console.log(chalk.green("Blissful Infra Orchestrator"));
  console.log(chalk.dim("  Dashboard: ") + chalk.cyan(`http://localhost:${dashboardPort}`));
  console.log(chalk.dim("  API:       ") + chalk.cyan(`http://localhost:${apiPort}`));
  console.log(chalk.dim("  Projects:  ") + chalk.cyan(workingDir));
  console.log();
  console.log(chalk.dim("Press Ctrl+C to stop"));
  console.log();

  // Start the Vite dev server for the dashboard
  const dashboardDir = path.join(__dirname, "..", "..", "..", "dashboard");

  try {
    await fs.access(dashboardDir);
  } catch {
    console.error(chalk.red("Dashboard package not found."));
    console.error(chalk.dim("The dashboard needs to be built. Run:"));
    console.error(chalk.cyan("  cd packages/dashboard && npm install && npm run dev"));
    process.exit(1);
  }

  // Open browser
  if (shouldOpen) {
    await openBrowser(`http://localhost:${dashboardPort}`);
  }

  // Run the dashboard dev server
  try {
    await execa("npm", ["run", "dev"], {
      cwd: dashboardDir,
      stdio: "inherit",
    });
  } catch (error) {
    // Check if it was a SIGINT
    if (error instanceof Error && "signal" in error && error.signal === "SIGINT") {
      // Normal exit
    } else {
      throw error;
    }
  } finally {
    await apiServer.stop();
  }
}

export const dashboardCommand = new Command("dashboard")
  .description("Open the orchestrator dashboard to manage all projects")
  .option("-p, --port <port>", "API server port", "3002")
  .option("--no-open", "Don't open browser automatically")
  .option("-d, --dir <directory>", "Working directory for projects", process.cwd())
  .action(async (opts: { port: string; open: boolean; dir: string }) => {
    await dashboardAction(opts);
  });
