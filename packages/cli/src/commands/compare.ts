import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { loadConfig, findProjectDir } from "../utils/config.js";

interface CompareOptions {
  old: string;
  new: string;
  duration?: string;
  vus?: string;
  baseUrl?: string;
  json?: boolean;
}

interface VersionMetrics {
  ref: string;
  requests: number;
  rps: number;
  latency: {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  errorRate: number;
  duration: number;
}

interface ComparisonResult {
  timestamp: string;
  project: string;
  oldRef: string;
  newRef: string;
  old: VersionMetrics;
  new: VersionMetrics;
  comparison: MetricComparison[];
  recommendation: "promote" | "rollback" | "inconclusive";
  confidence: number;
}

interface MetricComparison {
  metric: string;
  oldValue: string;
  newValue: string;
  winner: "old" | "new" | "tie";
  improvement: string;
}

async function getGitRef(projectDir: string, ref: string): Promise<string> {
  try {
    const { stdout } = await execa("git", ["rev-parse", "--short", ref], {
      cwd: projectDir,
      stdio: "pipe",
    });
    return stdout.trim();
  } catch {
    return ref;
  }
}

async function buildVersion(
  projectDir: string,
  ref: string,
  tag: string
): Promise<boolean> {
  try {
    // Stash current changes if any
    await execa("git", ["stash", "--include-untracked"], {
      cwd: projectDir,
      stdio: "pipe",
    }).catch(() => {});

    // Checkout the ref
    await execa("git", ["checkout", ref], {
      cwd: projectDir,
      stdio: "pipe",
    });

    // Build the docker image
    await execa("docker", ["compose", "build", "--quiet"], {
      cwd: projectDir,
      stdio: "pipe",
      timeout: 300000,
    });

    // Tag the built image
    const config = await loadConfig(projectDir);
    const projectName = config?.name || path.basename(projectDir);
    await execa("docker", ["tag", `${projectName}-app:latest`, `${projectName}-app:${tag}`], {
      cwd: projectDir,
      stdio: "pipe",
    }).catch(() => {});

    return true;
  } catch {
    return false;
  }
}

async function runLoadTest(
  baseUrl: string,
  duration: string,
  vus: string,
  label: string
): Promise<VersionMetrics | null> {
  // Use a simple curl-based load test if k6 is not available
  const hasK6 = await execa("k6", ["version"], { stdio: "pipe" }).then(() => true).catch(() => false);

  if (hasK6) {
    return runK6LoadTest(baseUrl, duration, vus, label);
  }

  return runCurlLoadTest(baseUrl, duration, label);
}

async function runK6LoadTest(
  baseUrl: string,
  duration: string,
  vus: string,
  label: string
): Promise<VersionMetrics | null> {
  // Create a temporary k6 script for comparison
  const script = `
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

const latency = new Trend('req_latency');
const errors = new Rate('req_errors');

export const options = {
  stages: [
    { duration: '${duration}', target: ${vus} },
    { duration: '${duration}', target: ${vus} },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
  },
};

export default function () {
  const endpoints = [
    { url: '${baseUrl}/health', weight: 30 },
    { url: '${baseUrl}/hello/compare-test', weight: 40 },
    { url: '${baseUrl}/ready', weight: 30 },
  ];

  const r = Math.random() * 100;
  let cumWeight = 0;
  let endpoint = endpoints[0].url;

  for (const ep of endpoints) {
    cumWeight += ep.weight;
    if (r <= cumWeight) { endpoint = ep.url; break; }
  }

  const res = http.get(endpoint);
  latency.add(res.timings.duration);
  errors.add(res.status >= 400);

  check(res, { 'status is ok': (r) => r.status < 400 });
  sleep(0.1);
}

export function handleSummary(data) {
  const metrics = data.metrics;
  const result = {
    ref: '${label}',
    requests: metrics.http_reqs ? metrics.http_reqs.values.count : 0,
    rps: metrics.http_reqs ? metrics.http_reqs.values.rate : 0,
    latency: {
      avg: metrics.http_req_duration ? metrics.http_req_duration.values.avg : 0,
      p50: metrics.http_req_duration ? metrics.http_req_duration.values['p(50)'] : 0,
      p95: metrics.http_req_duration ? metrics.http_req_duration.values['p(95)'] : 0,
      p99: metrics.http_req_duration ? metrics.http_req_duration.values['p(99)'] : 0,
    },
    errorRate: metrics.http_req_failed ? metrics.http_req_failed.values.rate : 0,
    duration: data.state.testRunDurationMs,
  };
  return { stdout: JSON.stringify(result) };
}
`;

  const tmpFile = path.join("/tmp", `k6-compare-${Date.now()}.js`);
  await fs.writeFile(tmpFile, script, "utf8");

  try {
    const { stdout } = await execa("k6", ["run", "--quiet", tmpFile], {
      stdio: "pipe",
      timeout: 600000,
    });

    await fs.unlink(tmpFile).catch(() => {});

    return JSON.parse(stdout.trim()) as VersionMetrics;
  } catch {
    await fs.unlink(tmpFile).catch(() => {});
    return null;
  }
}

async function runCurlLoadTest(
  baseUrl: string,
  duration: string,
  label: string
): Promise<VersionMetrics | null> {
  // Fallback: simple curl-based load test
  const durationMs = parseDurationMs(duration);
  const start = Date.now();
  let requests = 0;
  let errors = 0;
  let totalLatency = 0;
  const latencies: number[] = [];

  const endpoints = [`${baseUrl}/health`, `${baseUrl}/hello/compare-test`, `${baseUrl}/ready`];

  while (Date.now() - start < durationMs * 2) { // 2x for ramp + sustain
    const url = endpoints[requests % endpoints.length];
    const reqStart = Date.now();

    try {
      const { stdout } = await execa("curl", [
        "-s", "-o", "/dev/null", "-w", "%{http_code}",
        "--connect-timeout", "5",
        url,
      ], { stdio: "pipe", timeout: 10000 });

      const status = parseInt(stdout.trim(), 10);
      const latency = Date.now() - reqStart;
      latencies.push(latency);
      totalLatency += latency;
      if (status >= 400) errors++;
    } catch {
      errors++;
      latencies.push(Date.now() - reqStart);
    }

    requests++;
    // Don't overwhelm - small sleep
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const elapsed = Date.now() - start;
  latencies.sort((a, b) => a - b);

  return {
    ref: label,
    requests,
    rps: requests / (elapsed / 1000),
    latency: {
      avg: requests > 0 ? totalLatency / requests : 0,
      p50: latencies[Math.floor(latencies.length * 0.5)] || 0,
      p95: latencies[Math.floor(latencies.length * 0.95)] || 0,
      p99: latencies[Math.floor(latencies.length * 0.99)] || 0,
    },
    errorRate: requests > 0 ? errors / requests : 0,
    duration: elapsed,
  };
}

function parseDurationMs(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h)$/);
  if (!match) return 30000;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case "s": return value * 1000;
    case "m": return value * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    default: return 30000;
  }
}

function compareMetrics(old: VersionMetrics, newer: VersionMetrics): MetricComparison[] {
  const comparisons: MetricComparison[] = [];

  // p95 Latency (lower is better)
  const p95Diff = ((newer.latency.p95 - old.latency.p95) / old.latency.p95) * 100;
  comparisons.push({
    metric: "p95 Latency",
    oldValue: `${old.latency.p95.toFixed(1)}ms`,
    newValue: `${newer.latency.p95.toFixed(1)}ms`,
    winner: Math.abs(p95Diff) < 5 ? "tie" : newer.latency.p95 < old.latency.p95 ? "new" : "old",
    improvement: `${p95Diff > 0 ? "+" : ""}${p95Diff.toFixed(1)}%`,
  });

  // Throughput (higher is better)
  const rpsDiff = ((newer.rps - old.rps) / old.rps) * 100;
  comparisons.push({
    metric: "Throughput",
    oldValue: `${old.rps.toFixed(1)}/s`,
    newValue: `${newer.rps.toFixed(1)}/s`,
    winner: Math.abs(rpsDiff) < 5 ? "tie" : newer.rps > old.rps ? "new" : "old",
    improvement: `${rpsDiff > 0 ? "+" : ""}${rpsDiff.toFixed(1)}%`,
  });

  // Error Rate (lower is better)
  const errDiff = newer.errorRate - old.errorRate;
  comparisons.push({
    metric: "Error Rate",
    oldValue: `${(old.errorRate * 100).toFixed(2)}%`,
    newValue: `${(newer.errorRate * 100).toFixed(2)}%`,
    winner: Math.abs(errDiff) < 0.001 ? "tie" : newer.errorRate < old.errorRate ? "new" : "old",
    improvement: `${errDiff > 0 ? "+" : ""}${(errDiff * 100).toFixed(2)}%`,
  });

  // Avg Latency (lower is better)
  const avgDiff = ((newer.latency.avg - old.latency.avg) / old.latency.avg) * 100;
  comparisons.push({
    metric: "Avg Latency",
    oldValue: `${old.latency.avg.toFixed(1)}ms`,
    newValue: `${newer.latency.avg.toFixed(1)}ms`,
    winner: Math.abs(avgDiff) < 5 ? "tie" : newer.latency.avg < old.latency.avg ? "new" : "old",
    improvement: `${avgDiff > 0 ? "+" : ""}${avgDiff.toFixed(1)}%`,
  });

  // p99 Latency (lower is better)
  const p99Diff = ((newer.latency.p99 - old.latency.p99) / old.latency.p99) * 100;
  comparisons.push({
    metric: "p99 Latency",
    oldValue: `${old.latency.p99.toFixed(1)}ms`,
    newValue: `${newer.latency.p99.toFixed(1)}ms`,
    winner: Math.abs(p99Diff) < 5 ? "tie" : newer.latency.p99 < old.latency.p99 ? "new" : "old",
    improvement: `${p99Diff > 0 ? "+" : ""}${p99Diff.toFixed(1)}%`,
  });

  return comparisons;
}

function determineRecommendation(comparisons: MetricComparison[]): { recommendation: ComparisonResult["recommendation"]; confidence: number } {
  let newWins = 0;
  let oldWins = 0;
  let ties = 0;

  // Weight critical metrics more heavily
  const weights: Record<string, number> = {
    "p95 Latency": 3,
    "Error Rate": 3,
    "Throughput": 2,
    "Avg Latency": 1,
    "p99 Latency": 1,
  };

  let weightedNewWins = 0;
  let weightedOldWins = 0;
  let totalWeight = 0;

  for (const c of comparisons) {
    const weight = weights[c.metric] || 1;
    totalWeight += weight;

    if (c.winner === "new") {
      newWins++;
      weightedNewWins += weight;
    } else if (c.winner === "old") {
      oldWins++;
      weightedOldWins += weight;
    } else {
      ties++;
    }
  }

  const confidence = Math.round(
    (Math.abs(weightedNewWins - weightedOldWins) / totalWeight) * 100
  );

  if (weightedNewWins > weightedOldWins) {
    return { recommendation: "promote", confidence: Math.min(confidence, 95) };
  } else if (weightedOldWins > weightedNewWins) {
    return { recommendation: "rollback", confidence: Math.min(confidence, 95) };
  }

  return { recommendation: "inconclusive", confidence: 0 };
}

async function runCompare(projectDir: string, options: CompareOptions): Promise<void> {
  const config = await loadConfig(projectDir);
  const projectName = config?.name || path.basename(projectDir);
  const duration = options.duration || "15s";
  const vus = options.vus || "20";
  const baseUrl = options.baseUrl || "http://localhost:8080";

  const oldRef = await getGitRef(projectDir, options.old);
  const newRef = await getGitRef(projectDir, options.new);

  console.log(chalk.blue.bold(`\nVersion Comparison: ${projectName}`));
  console.log(chalk.gray(`Old: ${oldRef} (${options.old})`));
  console.log(chalk.gray(`New: ${newRef} (${options.new})`));
  console.log(chalk.gray(`Duration: ${duration} per version`));
  console.log(chalk.gray(`Base URL: ${baseUrl}`));
  console.log();

  // Step 1: Build old version
  let spinner = ora("Building old version...").start();
  const oldBuilt = await buildVersion(projectDir, options.old, "compare-old");
  if (!oldBuilt) {
    spinner.fail("Failed to build old version");
    process.exitCode = 1;
    return;
  }
  spinner.succeed("Old version built");

  // Step 2: Start old version and run load test
  spinner = ora("Starting old version...").start();
  try {
    await execa("docker", ["compose", "up", "-d"], { cwd: projectDir, stdio: "pipe" });
    // Wait for app to be ready
    await new Promise((resolve) => setTimeout(resolve, 15000));
    spinner.succeed("Old version running");
  } catch {
    spinner.fail("Failed to start old version");
    process.exitCode = 1;
    return;
  }

  spinner = ora(`Running load test against old version (${oldRef})...`).start();
  const oldMetrics = await runLoadTest(baseUrl, duration, vus, oldRef);
  spinner.succeed(`Old version tested: ${oldMetrics?.rps.toFixed(1) || "?"} RPS`);

  // Step 3: Stop old, build and start new
  await execa("docker", ["compose", "down"], { cwd: projectDir, stdio: "pipe" }).catch(() => {});

  spinner = ora("Building new version...").start();
  const newBuilt = await buildVersion(projectDir, options.new, "compare-new");
  if (!newBuilt) {
    spinner.fail("Failed to build new version");
    // Restore original branch
    await execa("git", ["checkout", "-"], { cwd: projectDir, stdio: "pipe" }).catch(() => {});
    await execa("git", ["stash", "pop"], { cwd: projectDir, stdio: "pipe" }).catch(() => {});
    process.exitCode = 1;
    return;
  }
  spinner.succeed("New version built");

  spinner = ora("Starting new version...").start();
  try {
    await execa("docker", ["compose", "up", "-d"], { cwd: projectDir, stdio: "pipe" });
    await new Promise((resolve) => setTimeout(resolve, 15000));
    spinner.succeed("New version running");
  } catch {
    spinner.fail("Failed to start new version");
    await execa("git", ["checkout", "-"], { cwd: projectDir, stdio: "pipe" }).catch(() => {});
    await execa("git", ["stash", "pop"], { cwd: projectDir, stdio: "pipe" }).catch(() => {});
    process.exitCode = 1;
    return;
  }

  spinner = ora(`Running load test against new version (${newRef})...`).start();
  const newMetrics = await runLoadTest(baseUrl, duration, vus, newRef);
  spinner.succeed(`New version tested: ${newMetrics?.rps.toFixed(1) || "?"} RPS`);

  // Step 4: Cleanup - stop and restore original branch
  await execa("docker", ["compose", "down"], { cwd: projectDir, stdio: "pipe" }).catch(() => {});
  await execa("git", ["checkout", "-"], { cwd: projectDir, stdio: "pipe" }).catch(() => {});
  await execa("git", ["stash", "pop"], { cwd: projectDir, stdio: "pipe" }).catch(() => {});

  if (!oldMetrics || !newMetrics) {
    console.log(chalk.red("\nError: Failed to collect metrics from one or both versions."));
    process.exitCode = 1;
    return;
  }

  // Step 5: Compare results
  console.log();
  const comparisons = compareMetrics(oldMetrics, newMetrics);
  const { recommendation, confidence } = determineRecommendation(comparisons);

  const result: ComparisonResult = {
    timestamp: new Date().toISOString(),
    project: projectName,
    oldRef,
    newRef,
    old: oldMetrics,
    new: newMetrics,
    comparison: comparisons,
    recommendation,
    confidence,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Display comparison table
  console.log(chalk.white.bold("Comparison Results:\n"));
  console.log(
    `  ${chalk.white("Metric".padEnd(16))} ${chalk.gray("Old".padEnd(14))} ${chalk.gray("New".padEnd(14))} ${chalk.white("Winner")}`
  );
  console.log(chalk.gray("  " + "-".repeat(55)));

  for (const c of comparisons) {
    const winnerIcon = c.winner === "new" ? chalk.green("✓ New") : c.winner === "old" ? chalk.yellow("✓ Old") : chalk.gray("  Tie");
    const changeColor = c.winner === "new" ? chalk.green : c.winner === "old" ? chalk.yellow : chalk.gray;
    console.log(
      `  ${chalk.white(c.metric.padEnd(16))} ${chalk.cyan(c.oldValue.padEnd(14))} ${chalk.cyan(c.newValue.padEnd(14))} ${winnerIcon} ${changeColor(`(${c.improvement})`)}`
    );
  }

  console.log();

  // Recommendation
  const recColor = recommendation === "promote" ? chalk.green : recommendation === "rollback" ? chalk.red : chalk.yellow;
  const recText = recommendation === "promote"
    ? "Promote new version"
    : recommendation === "rollback"
      ? "Keep old version"
      : "Results inconclusive - manual review recommended";

  console.log(chalk.white.bold("Recommendation: ") + recColor.bold(recText));
  if (confidence > 0) {
    console.log(chalk.gray(`Confidence: ${confidence}%`));
  }

  // Save results
  const resultsDir = path.join(projectDir, ".blissful-infra", "compare");
  await fs.mkdir(resultsDir, { recursive: true });
  const resultsFile = path.join(
    resultsDir,
    `compare-${oldRef}-vs-${newRef}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  await fs.writeFile(resultsFile, JSON.stringify(result, null, 2), "utf8");
  console.log(chalk.gray(`\nResults saved to: ${path.relative(projectDir, resultsFile)}`));
}

export const compareCommand = new Command("compare")
  .description("Compare performance between two versions")
  .argument("[name]", "Project name")
  .requiredOption("--old <ref>", "Old version git ref (branch, tag, or commit)")
  .requiredOption("--new <ref>", "New version git ref (branch, tag, or commit)")
  .option("-d, --duration <duration>", "Duration per version", "15s")
  .option("-u, --vus <count>", "Virtual users for load test", "20")
  .option("-b, --base-url <url>", "Base URL to test against", "http://localhost:8080")
  .option("--json", "Output results as JSON")
  .action(async (name: string | undefined, options: CompareOptions) => {
    const projectDir = await findProjectDir(name);
    if (!projectDir) {
      console.log(chalk.red("Error: Not in a blissful-infra project directory."));
      console.log(chalk.gray("Run from a project directory or specify the project name."));
      process.exit(1);
    }
    await runCompare(projectDir, options);
  });

export async function compareAction(name: string, options: CompareOptions): Promise<void> {
  const projectDir = await findProjectDir(name);
  if (!projectDir) {
    console.log(chalk.red(`Error: Project '${name}' not found.`));
    return;
  }
  await runCompare(projectDir, options);
}
