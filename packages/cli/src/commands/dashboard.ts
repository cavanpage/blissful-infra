import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { createApiServer } from "../server/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function findProjectDir(name?: string): Promise<string | null> {
  if (name) {
    const projectDir = path.join(process.cwd(), name);
    try {
      await fs.access(path.join(projectDir, "blissful-infra.yaml"));
      return projectDir;
    } catch {
      return null;
    }
  }

  try {
    await fs.access(path.join(process.cwd(), "blissful-infra.yaml"));
    return process.cwd();
  } catch {
    return null;
  }
}

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

export const dashboardCommand = new Command("dashboard")
  .description("Open the web dashboard")
  .argument("[name]", "Project name (if running from parent directory)")
  .option("-p, --port <port>", "API server port", "3002")
  .option("--no-open", "Don't open browser automatically")
  .action(async (name: string | undefined, opts: { port: string; open: boolean }) => {
    // Find project directory
    const projectDir = await findProjectDir(name);
    if (!projectDir) {
      if (name) {
        console.error(chalk.red(`Project '${name}' not found.`));
      } else {
        console.error(chalk.red("No blissful-infra.yaml found."));
        console.error(chalk.dim("Run from project directory or specify project name:"));
        console.error(chalk.cyan("  blissful-infra dashboard my-app"));
      }
      process.exit(1);
    }

    const apiPort = parseInt(opts.port, 10);
    const dashboardPort = 3001;

    // Start API server
    const spinner = ora("Starting dashboard...").start();

    const apiServer = createApiServer(projectDir, apiPort);
    await apiServer.start();

    spinner.succeed("Dashboard ready");

    console.log();
    console.log(chalk.green("Dashboard running:"));
    console.log(chalk.dim("  Dashboard: ") + chalk.cyan(`http://localhost:${dashboardPort}`));
    console.log(chalk.dim("  API:       ") + chalk.cyan(`http://localhost:${apiPort}`));
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
    if (opts.open) {
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
  });
