import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { loadConfig, findProjectDir } from "../utils/config.js";
import { toExecError } from "../utils/errors.js";

interface PerfOptions {
  env?: string;
  duration?: string;
  vus?: string;
  baseUrl?: string;
  script?: string;
  json?: boolean;
}

interface PerfResults {
  timestamp: string;
  duration: number;
  vus: { max: number };
  requests: { total: number; rate: number; failed: number };
  latency: {
    avg: number;
    min: number;
    max: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
  errorRate: number;
}

interface ThresholdResult {
  passed: boolean;
  metric: string;
  value: string;
  threshold: string;
}

async function checkK6Installed(): Promise<boolean> {
  try {
    await execa("k6", ["version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function findTestScript(projectDir: string, customScript?: string): Promise<string | null> {
  if (customScript) {
    const scriptPath = path.resolve(customScript);
    try {
      await fs.access(scriptPath);
      return scriptPath;
    } catch {
      return null;
    }
  }

  // Look for k6 test scripts in standard locations
  const candidates = [
    path.join(projectDir, "k6", "load-test.js"),
    path.join(projectDir, "k6", "test.js"),
    path.join(projectDir, "perf", "load-test.js"),
    path.join(projectDir, "tests", "k6", "load-test.js"),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Continue
    }
  }

  return null;
}

function resolveBaseUrl(env: string, baseUrl?: string): string {
  if (baseUrl) return baseUrl;

  switch (env) {
    case "local":
      return "http://localhost:8080";
    case "staging":
      return "http://localhost:8080"; // Would be actual staging URL in real setup
    case "production":
      return "http://localhost:8080";
    default:
      return "http://localhost:8080";
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes > 0) return `${minutes}m ${remaining}s`;
  return `${seconds}s`;
}

function evaluateThresholds(results: PerfResults): ThresholdResult[] {
  const thresholds: ThresholdResult[] = [
    {
      passed: results.latency.p95 < 500,
      metric: "p95 Latency",
      value: `${results.latency.p95.toFixed(1)}ms`,
      threshold: "< 500ms",
    },
    {
      passed: results.latency.p99 < 1000,
      metric: "p99 Latency",
      value: `${results.latency.p99.toFixed(1)}ms`,
      threshold: "< 1000ms",
    },
    {
      passed: results.errorRate < 0.01,
      metric: "Error Rate",
      value: `${(results.errorRate * 100).toFixed(2)}%`,
      threshold: "< 1%",
    },
    {
      passed: results.latency.avg < 200,
      metric: "Avg Latency",
      value: `${results.latency.avg.toFixed(1)}ms`,
      threshold: "< 200ms",
    },
  ];

  return thresholds;
}

async function runPerfTest(
  projectDir: string,
  options: PerfOptions
): Promise<void> {
  const config = await loadConfig(projectDir);
  const projectName = config?.name || path.basename(projectDir);
  const env = options.env || "local";

  console.log(chalk.blue.bold(`\nPerformance Test: ${projectName}`));
  console.log(chalk.gray(`Environment: ${env}`));
  console.log();

  // Check k6 is installed
  const k6Installed = await checkK6Installed();
  if (!k6Installed) {
    console.log(chalk.red("Error: k6 is not installed."));
    console.log(chalk.gray("Install with:"));
    console.log(chalk.gray("  macOS: brew install k6"));
    console.log(chalk.gray("  Linux: snap install k6"));
    console.log(chalk.gray("  Docker: docker run --rm -i grafana/k6 run -"));
    console.log(chalk.gray("  More: https://k6.io/docs/getting-started/installation/"));
    process.exit(1);
  }

  // Find test script
  const scriptPath = await findTestScript(projectDir, options.script);
  if (!scriptPath) {
    console.log(chalk.red("Error: No k6 test script found."));
    console.log(chalk.gray("Expected at: k6/load-test.js"));
    console.log(chalk.gray("Or specify with: --script <path>"));
    process.exit(1);
  }

  const baseUrl = resolveBaseUrl(env, options.baseUrl);
  const duration = options.duration || "30s";
  const maxVus = options.vus || "50";

  console.log(chalk.gray(`Script: ${path.relative(projectDir, scriptPath)}`));
  console.log(chalk.gray(`Base URL: ${baseUrl}`));
  console.log(chalk.gray(`Duration: ${duration} per stage`));
  console.log(chalk.gray(`Max VUs: ${maxVus}`));
  console.log();

  const spinner = ora("Running k6 load test...").start();

  try {
    // Run k6 with environment variables
    const { stdout, stderr } = await execa("k6", ["run", scriptPath], {
      env: {
        ...process.env,
        BASE_URL: baseUrl,
        STAGE_DURATION: duration,
        MAX_VUS: maxVus,
      },
      cwd: projectDir,
      stdio: "pipe",
      timeout: 600000, // 10 minute timeout
    });

    spinner.stop();

    // Parse JSON results from stdout
    let results: PerfResults;
    try {
      results = JSON.parse(stdout.trim());
    } catch {
      // k6 didn't output our custom JSON, show raw output
      console.log(stdout);
      if (stderr) console.log(chalk.yellow(stderr));
      return;
    }

    // Display results
    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    console.log(chalk.green.bold("Results:\n"));

    // Summary table
    console.log(chalk.white("  Requests:    ") + chalk.cyan(results.requests.total.toLocaleString()));
    console.log(chalk.white("  Duration:    ") + chalk.cyan(formatDuration(results.duration)));
    console.log(chalk.white("  RPS:         ") + chalk.cyan(results.requests.rate.toFixed(1)));
    console.log(chalk.white("  Max VUs:     ") + chalk.cyan(results.vus.max.toString()));
    console.log();

    // Latency breakdown
    console.log(chalk.white.bold("  Latency:"));
    console.log(chalk.white("    avg:     ") + chalk.cyan(`${results.latency.avg.toFixed(1)}ms`));
    console.log(chalk.white("    p50:     ") + chalk.cyan(`${results.latency.p50.toFixed(1)}ms`));
    console.log(chalk.white("    p90:     ") + chalk.cyan(`${results.latency.p90.toFixed(1)}ms`));
    console.log(chalk.white("    p95:     ") + chalk.cyan(`${results.latency.p95.toFixed(1)}ms`));
    console.log(chalk.white("    p99:     ") + chalk.cyan(`${results.latency.p99.toFixed(1)}ms`));
    console.log(chalk.white("    max:     ") + chalk.cyan(`${results.latency.max.toFixed(1)}ms`));
    console.log();

    console.log(chalk.white("  Error Rate:  ") + chalk.cyan(`${(results.errorRate * 100).toFixed(2)}%`));
    console.log();

    // Threshold evaluation
    const thresholds = evaluateThresholds(results);
    const allPassed = thresholds.every((t) => t.passed);

    console.log(chalk.white.bold("  Thresholds:"));
    for (const threshold of thresholds) {
      const icon = threshold.passed ? chalk.green("✓") : chalk.red("✗");
      const valueColor = threshold.passed ? chalk.green : chalk.red;
      console.log(
        `    ${icon} ${chalk.white(threshold.metric.padEnd(14))} ${valueColor(
          threshold.value.padEnd(12)
        )} ${chalk.gray(`(${threshold.threshold})`)}`
      );
    }

    console.log();
    if (allPassed) {
      console.log(chalk.green.bold("✓ All thresholds passed"));
    } else {
      console.log(chalk.red.bold("✗ Some thresholds failed"));
      process.exitCode = 1;
    }

    // Save results to file
    const resultsDir = path.join(projectDir, ".blissful-infra", "perf");
    await fs.mkdir(resultsDir, { recursive: true });
    const resultsFile = path.join(
      resultsDir,
      `perf-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );
    await fs.writeFile(resultsFile, JSON.stringify(results, null, 2), "utf8");
    console.log(chalk.gray(`\nResults saved to: ${path.relative(projectDir, resultsFile)}`));
  } catch (error) {
    spinner.stop();
    const execaError = toExecError(error);

    if (execaError.stderr?.includes("connection refused")) {
      console.log(chalk.red("\nError: Could not connect to the application."));
      console.log(chalk.gray(`Make sure the app is running at ${baseUrl}`));
      console.log(chalk.gray("Start it with: blissful-infra up"));
    } else {
      console.log(chalk.red(`\nPerformance test failed:`));
      console.log(chalk.gray(execaError.stderr || execaError.message));
    }
    process.exitCode = 1;
  }
}

export const perfCommand = new Command("perf")
  .description("Run performance tests with k6")
  .argument("[name]", "Project name")
  .option("-e, --env <environment>", "Target environment", "local")
  .option("-d, --duration <duration>", "Duration per stage", "30s")
  .option("-u, --vus <count>", "Maximum virtual users", "50")
  .option("-b, --base-url <url>", "Base URL to test against")
  .option("-s, --script <path>", "Custom k6 script path")
  .option("--json", "Output results as JSON")
  .action(async (name: string | undefined, options: PerfOptions) => {
    const projectDir = await findProjectDir(name);
    if (!projectDir) {
      console.log(chalk.red("Error: Not in a blissful-infra project directory."));
      console.log(chalk.gray("Run from a project directory or specify the project name."));
      process.exit(1);
    }
    await runPerfTest(projectDir, options);
  });

export async function perfAction(name: string, options: PerfOptions = {}): Promise<void> {
  const projectDir = await findProjectDir(name);
  if (!projectDir) {
    console.log(chalk.red(`Error: Project '${name}' not found.`));
    return;
  }
  await runPerfTest(projectDir, options);
}
