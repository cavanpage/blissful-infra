import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, findProjectDir } from "../utils/config.js";
import {
  chaosScenarios,
  getAvailableScenarios,
  getScenario,
  type ChaosResult,
  type ChaosRunOptions,
} from "../utils/chaos.js";
import {
  saveScoreEntry,
  generateScorecard,
  type ScoreEntry,
} from "../utils/scorecard.js";

interface ChaosOptions {
  env?: string;
  scenario?: string;
  duration?: string;
  intensity?: "low" | "medium" | "high";
  service?: string;
  dryRun?: boolean;
  json?: boolean;
}

interface FMEAReport {
  timestamp: string;
  project: string;
  environment: string;
  results: ChaosResult[];
  score: number;
  maxScore: number;
  recommendations: string[];
}

function calculateResilienceScore(results: ChaosResult[]): { score: number; maxScore: number } {
  let score = 0;
  const maxScore = results.length * 25; // 25 points per scenario

  for (const result of results) {
    if (!result.passed) continue;

    // Base score for passing
    score += 15;

    // Bonus for fast recovery
    if (result.recoveryTimeMs !== null) {
      if (result.recoveryTimeMs < 5000) score += 10;
      else if (result.recoveryTimeMs < 15000) score += 7;
      else if (result.recoveryTimeMs < 30000) score += 4;
      else score += 1;
    }
  }

  return { score, maxScore };
}

function generateRecommendations(results: ChaosResult[]): string[] {
  const recommendations: string[] = [];

  for (const result of results) {
    if (result.passed) continue;

    switch (result.scenario) {
      case "pod-kill":
        recommendations.push("Add restart policy and health checks to ensure container auto-recovery");
        recommendations.push("Consider implementing graceful shutdown handlers");
        break;
      case "network-latency":
        recommendations.push("Add request timeouts and retry logic with exponential backoff");
        recommendations.push("Consider implementing circuit breakers for downstream calls");
        break;
      case "kafka-down":
        recommendations.push("Add circuit breaker for Kafka event publishing");
        recommendations.push("Implement fallback behavior when Kafka is unavailable (e.g., queue locally)");
        recommendations.push("Ensure health endpoint reports degraded (not down) when Kafka is unavailable");
        break;
      case "db-latency":
        recommendations.push("Configure connection pool timeouts to handle slow database responses");
        recommendations.push("Add database query timeouts to prevent thread exhaustion");
        recommendations.push("Consider implementing read-through caching for frequently accessed data");
        break;
      case "memory-pressure":
        recommendations.push("Set appropriate JVM heap limits (-Xmx) relative to container limits");
        recommendations.push("Implement memory-aware caching with eviction policies");
        recommendations.push("Add memory usage monitoring and alerting");
        break;
    }

    // Recovery time recommendations
    if (result.recoveryTimeMs !== null && result.recoveryTimeMs > 30000) {
      recommendations.push(`Improve recovery time for ${result.scenario} (currently ${(result.recoveryTimeMs / 1000).toFixed(1)}s, target < 30s)`);
    }
  }

  return [...new Set(recommendations)]; // Deduplicate
}

async function runChaos(projectDir: string, options: ChaosOptions): Promise<void> {
  const config = await loadConfig(projectDir);
  const projectName = config?.name || path.basename(projectDir);
  const env = options.env || "local";

  console.log(chalk.blue.bold(`\nChaos Engineering: ${projectName}`));
  console.log(chalk.gray(`Environment: ${env}`));
  console.log();

  const runOptions: ChaosRunOptions = {
    duration: options.duration || "30s",
    intensity: options.intensity || "medium",
    service: options.service,
    dryRun: options.dryRun,
  };

  // Determine which scenarios to run
  let scenariosToRun: string[];
  if (options.scenario) {
    const scenario = getScenario(options.scenario);
    if (!scenario) {
      console.log(chalk.red(`Error: Unknown scenario '${options.scenario}'`));
      console.log(chalk.gray("Available scenarios:"));
      for (const s of getAvailableScenarios()) {
        console.log(chalk.gray(`  ${s.name.padEnd(20)} ${s.description}`));
      }
      process.exitCode = 1;
      return;
    }
    scenariosToRun = [options.scenario];
  } else {
    // Run all scenarios (FMEA mode)
    scenariosToRun = Object.keys(chaosScenarios);
  }

  if (options.dryRun) {
    console.log(chalk.yellow("DRY RUN MODE - No changes will be made\n"));
  }

  console.log(chalk.white.bold("Running FMEA scenarios...\n"));

  const results: ChaosResult[] = [];

  for (const scenarioName of scenariosToRun) {
    const scenario = chaosScenarios[scenarioName];
    const spinner = ora(`${scenario.name}: ${scenario.description}`).start();

    try {
      const result = await scenario.run(projectName, runOptions);
      results.push(result);

      if (result.passed) {
        const recovery = result.recoveryTimeMs !== null
          ? ` (${(result.recoveryTimeMs / 1000).toFixed(1)}s recovery)`
          : "";
        spinner.succeed(chalk.green(`${scenario.name}: Pass${recovery}`));
      } else {
        spinner.fail(chalk.red(`${scenario.name}: Fail`));
      }

      if (!options.json) {
        console.log(chalk.gray(`    ${result.details}`));
      }
    } catch (error) {
      const err = error as Error;
      spinner.fail(chalk.red(`${scenario.name}: Error`));
      results.push({
        scenario: scenarioName,
        passed: false,
        recoveryTimeMs: null,
        details: err.message || "Unknown error",
      });
      if (!options.json) {
        console.log(chalk.gray(`    ${err.message}`));
      }
    }

    // Brief pause between scenarios for system stability
    if (scenariosToRun.indexOf(scenarioName) < scenariosToRun.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  console.log();

  // Calculate resilience score
  const { score, maxScore } = calculateResilienceScore(results);
  const recommendations = generateRecommendations(results);

  const report: FMEAReport = {
    timestamp: new Date().toISOString(),
    project: projectName,
    environment: env,
    results,
    score,
    maxScore,
    recommendations,
  };

  // Output results
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Summary table
  console.log(chalk.white.bold("Results:\n"));
  console.log(
    chalk.white("  Scenario".padEnd(22)) +
    chalk.white("Result".padEnd(10)) +
    chalk.white("Recovery")
  );
  console.log(chalk.gray("  " + "-".repeat(45)));

  for (const result of results) {
    const icon = result.passed ? chalk.green("✓ Pass") : chalk.red("✗ Fail");
    const recovery = result.recoveryTimeMs !== null
      ? `${(result.recoveryTimeMs / 1000).toFixed(1)}s`
      : "N/A";
    console.log(
      `  ${chalk.white(result.scenario.padEnd(20))} ${icon.padEnd(18)} ${chalk.cyan(recovery)}`
    );
  }

  console.log();

  // Resilience score
  const scorePercent = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  const scoreColor = scorePercent >= 80 ? chalk.green : scorePercent >= 50 ? chalk.yellow : chalk.red;
  console.log(chalk.white.bold(`Resilience Score: `) + scoreColor.bold(`${score}/${maxScore} (${scorePercent}%)`));
  console.log();

  // Recommendations
  if (recommendations.length > 0) {
    console.log(chalk.white.bold("Recommendations:\n"));
    for (const rec of recommendations) {
      console.log(chalk.yellow(`  → ${rec}`));
    }
    console.log();
  }

  const allPassed = results.every((r) => r.passed);
  if (allPassed) {
    console.log(chalk.green.bold("✓ All scenarios passed"));
  } else {
    const failCount = results.filter((r) => !r.passed).length;
    console.log(chalk.red.bold(`✗ ${failCount} scenario(s) failed`));
    process.exitCode = 1;
  }

  // Save report
  const reportsDir = path.join(projectDir, ".blissful-infra", "chaos");
  await fs.mkdir(reportsDir, { recursive: true });
  const reportFile = path.join(
    reportsDir,
    `chaos-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2), "utf8");
  console.log(chalk.gray(`\nReport saved to: ${path.relative(projectDir, reportFile)}`));

  // Save score entry for scorecard tracking
  if (!options.dryRun) {
    const scenarioResults: Record<string, { passed: boolean; recoveryMs: number | null }> = {};
    for (const result of results) {
      scenarioResults[result.scenario] = {
        passed: result.passed,
        recoveryMs: result.recoveryTimeMs,
      };
    }
    const scoreEntry: ScoreEntry = {
      timestamp: new Date().toISOString(),
      score,
      maxScore,
      scenarioResults,
    };
    await saveScoreEntry(projectDir, scoreEntry);
  }
}

async function showScorecard(projectDir: string, projectName: string, json: boolean): Promise<void> {
  const scorecard = await generateScorecard(projectDir, projectName);

  if (json) {
    console.log(JSON.stringify(scorecard, null, 2));
    return;
  }

  console.log(chalk.blue.bold(`\nResilience Scorecard: ${scorecard.project}\n`));

  // Current score
  const scoreColor = scorecard.percentage >= 80 ? chalk.green : scorecard.percentage >= 50 ? chalk.yellow : chalk.red;
  console.log(chalk.white.bold("  Score: ") + scoreColor.bold(`${scorecard.currentScore}/${scorecard.maxScore} (${scorecard.percentage}%)`));

  // Trend
  const trendIcons = { improving: chalk.green("↑ Improving"), declining: chalk.red("↓ Declining"), stable: chalk.cyan("→ Stable"), new: chalk.gray("● New") };
  console.log(chalk.white.bold("  Trend: ") + trendIcons[scorecard.trend]);
  console.log();

  // Strengths
  if (scorecard.strengths.length > 0) {
    console.log(chalk.green.bold("  Strengths:"));
    for (const s of scorecard.strengths) {
      console.log(chalk.green(`    ✓ ${s}`));
    }
    console.log();
  }

  // Gaps
  if (scorecard.gaps.length > 0) {
    console.log(chalk.red.bold("  Gaps:"));
    for (const gap of scorecard.gaps) {
      const sevColor = gap.severity === "critical" ? chalk.red : gap.severity === "high" ? chalk.yellow : chalk.gray;
      console.log(`    ${sevColor(`[${gap.severity.toUpperCase()}]`)} ${chalk.white(gap.category)}: ${gap.description}`);
      console.log(chalk.gray(`          → ${gap.recommendation}`));
    }
    console.log();
  }

  // History (last 5)
  if (scorecard.history.length > 1) {
    console.log(chalk.white.bold("  Recent History:"));
    const recent = scorecard.history.slice(-5);
    for (const entry of recent) {
      const pct = entry.maxScore > 0 ? Math.round((entry.score / entry.maxScore) * 100) : 0;
      const date = new Date(entry.timestamp).toLocaleDateString();
      const pctColor = pct >= 80 ? chalk.green : pct >= 50 ? chalk.yellow : chalk.red;
      console.log(`    ${chalk.gray(date)}  ${pctColor(`${pct}%`)}  (${entry.score}/${entry.maxScore})`);
    }
    console.log();
  }
}

export const chaosCommand = new Command("chaos")
  .description("Run chaos engineering experiments (FMEA)")
  .argument("[name]", "Project name")
  .option("-e, --env <environment>", "Target environment", "local")
  .option("-s, --scenario <name>", "Run specific scenario (pod-kill, network-latency, kafka-down, db-latency, memory-pressure)")
  .option("-d, --duration <duration>", "Duration per experiment", "30s")
  .option("-i, --intensity <level>", "Chaos intensity (low, medium, high)", "medium")
  .option("--service <name>", "Target specific service")
  .option("--dry-run", "Show what would happen without running")
  .option("--json", "Output results as JSON")
  .option("--scorecard", "Show resilience scorecard instead of running tests")
  .action(async (name: string | undefined, options: ChaosOptions & { scorecard?: boolean }) => {
    const projectDir = await findProjectDir(name);
    if (!projectDir) {
      console.log(chalk.red("Error: Not in a blissful-infra project directory."));
      console.log(chalk.gray("Run from a project directory or specify the project name."));
      process.exit(1);
    }

    if (options.scorecard) {
      const config = await loadConfig(projectDir);
      const projectName = config?.name || path.basename(projectDir);
      await showScorecard(projectDir, projectName, !!options.json);
      return;
    }

    await runChaos(projectDir, options);
  });

export async function chaosAction(name: string, options: ChaosOptions = {}): Promise<void> {
  const projectDir = await findProjectDir(name);
  if (!projectDir) {
    console.log(chalk.red(`Error: Project '${name}' not found.`));
    return;
  }
  await runChaos(projectDir, options);
}
