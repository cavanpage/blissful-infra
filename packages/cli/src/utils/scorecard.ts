import fs from "node:fs/promises";
import path from "node:path";

/**
 * Resilience scorecard - tracks chaos test results over time
 * and identifies gaps in resilience posture.
 */

export interface ScoreEntry {
  timestamp: string;
  score: number;
  maxScore: number;
  scenarioResults: Record<string, { passed: boolean; recoveryMs: number | null }>;
}

export interface ResilienceGap {
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  recommendation: string;
}

export interface Scorecard {
  project: string;
  currentScore: number;
  maxScore: number;
  percentage: number;
  trend: "improving" | "declining" | "stable" | "new";
  history: ScoreEntry[];
  gaps: ResilienceGap[];
  strengths: string[];
}

const DATA_DIR = ".blissful-infra";
const SCORECARD_FILE = "resilience-scores.json";

function getScorecardsPath(projectDir: string): string {
  return path.join(projectDir, DATA_DIR, SCORECARD_FILE);
}

export async function loadScoreHistory(projectDir: string): Promise<ScoreEntry[]> {
  try {
    const content = await fs.readFile(getScorecardsPath(projectDir), "utf8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export async function saveScoreEntry(
  projectDir: string,
  entry: ScoreEntry
): Promise<void> {
  const history = await loadScoreHistory(projectDir);
  history.push(entry);

  // Keep last 50 entries
  const trimmed = history.slice(-50);

  await fs.mkdir(path.join(projectDir, DATA_DIR), { recursive: true });
  await fs.writeFile(getScorecardsPath(projectDir), JSON.stringify(trimmed, null, 2), "utf8");
}

function determineTrend(history: ScoreEntry[]): Scorecard["trend"] {
  if (history.length < 2) return "new";

  const recent = history.slice(-5);
  if (recent.length < 2) return "new";

  const first = recent[0];
  const last = recent[recent.length - 1];
  const firstPct = first.maxScore > 0 ? first.score / first.maxScore : 0;
  const lastPct = last.maxScore > 0 ? last.score / last.maxScore : 0;

  const diff = lastPct - firstPct;
  if (diff > 0.05) return "improving";
  if (diff < -0.05) return "declining";
  return "stable";
}

function identifyGaps(
  latestResults: Record<string, { passed: boolean; recoveryMs: number | null }>
): ResilienceGap[] {
  const gaps: ResilienceGap[] = [];

  // Check each scenario for gaps
  const scenarioGaps: Record<string, { severity: ResilienceGap["severity"]; category: string; desc: string; rec: string }> = {
    "pod-kill": {
      severity: "critical",
      category: "Self-healing",
      desc: "Application does not recover from container termination",
      rec: "Add restart policy, health checks, and graceful shutdown handlers",
    },
    "network-latency": {
      severity: "high",
      category: "Network Resilience",
      desc: "Application fails under network latency conditions",
      rec: "Implement request timeouts, retries with backoff, and circuit breakers",
    },
    "kafka-down": {
      severity: "high",
      category: "Dependency Isolation",
      desc: "Application does not gracefully degrade when Kafka is unavailable",
      rec: "Add circuit breaker for event publishing, implement local fallback queue",
    },
    "db-latency": {
      severity: "high",
      category: "Database Resilience",
      desc: "Application fails under database latency conditions",
      rec: "Configure connection pool timeouts, add query timeouts, consider read caching",
    },
    "memory-pressure": {
      severity: "medium",
      category: "Resource Management",
      desc: "Application crashes under memory pressure",
      rec: "Set JVM heap limits, implement bounded caches, add memory monitoring",
    },
  };

  for (const [scenario, result] of Object.entries(latestResults)) {
    if (!result.passed && scenarioGaps[scenario]) {
      const gap = scenarioGaps[scenario];
      gaps.push({
        category: gap.category,
        severity: gap.severity,
        description: gap.desc,
        recommendation: gap.rec,
      });
    }

    // Slow recovery is also a gap
    if (result.passed && result.recoveryMs !== null && result.recoveryMs > 30000) {
      gaps.push({
        category: "Recovery Speed",
        severity: "medium",
        description: `Slow recovery for ${scenario}: ${(result.recoveryMs / 1000).toFixed(1)}s (target: < 30s)`,
        recommendation: "Optimize startup time, add readiness probes, pre-warm connections",
      });
    }
  }

  // Check for missing scenarios
  const expectedScenarios = ["pod-kill", "network-latency", "kafka-down", "db-latency", "memory-pressure"];
  const testedScenarios = Object.keys(latestResults);
  const untested = expectedScenarios.filter((s) => !testedScenarios.includes(s));

  if (untested.length > 0) {
    gaps.push({
      category: "Coverage",
      severity: "low",
      description: `Untested scenarios: ${untested.join(", ")}`,
      recommendation: `Run full FMEA suite: blissful-infra chaos`,
    });
  }

  return gaps;
}

function identifyStrengths(
  latestResults: Record<string, { passed: boolean; recoveryMs: number | null }>
): string[] {
  const strengths: string[] = [];

  for (const [scenario, result] of Object.entries(latestResults)) {
    if (!result.passed) continue;

    if (result.recoveryMs !== null && result.recoveryMs < 5000) {
      strengths.push(`Fast recovery from ${scenario} (${(result.recoveryMs / 1000).toFixed(1)}s)`);
    } else if (result.passed) {
      strengths.push(`Resilient to ${scenario}`);
    }
  }

  const allPassed = Object.values(latestResults).every((r) => r.passed);
  if (allPassed && Object.keys(latestResults).length >= 3) {
    strengths.push("Passes all tested chaos scenarios");
  }

  return strengths;
}

export async function generateScorecard(
  projectDir: string,
  projectName: string
): Promise<Scorecard> {
  const history = await loadScoreHistory(projectDir);

  if (history.length === 0) {
    return {
      project: projectName,
      currentScore: 0,
      maxScore: 0,
      percentage: 0,
      trend: "new",
      history: [],
      gaps: [{
        category: "Coverage",
        severity: "low",
        description: "No chaos tests have been run yet",
        recommendation: "Run: blissful-infra chaos",
      }],
      strengths: [],
    };
  }

  const latest = history[history.length - 1];
  const percentage = latest.maxScore > 0 ? Math.round((latest.score / latest.maxScore) * 100) : 0;

  return {
    project: projectName,
    currentScore: latest.score,
    maxScore: latest.maxScore,
    percentage,
    trend: determineTrend(history),
    history,
    gaps: identifyGaps(latest.scenarioResults),
    strengths: identifyStrengths(latest.scenarioResults),
  };
}
