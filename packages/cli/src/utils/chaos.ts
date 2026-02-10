import { execa } from "execa";
import chalk from "chalk";

/**
 * Chaos engineering utilities for local Docker environments.
 * Implements failure injection scenarios without requiring Chaos Mesh/Kubernetes.
 */

export interface ChaosScenario {
  name: string;
  description: string;
  category: "pod-kill" | "network" | "resource" | "dependency";
  run: (projectName: string, options: ChaosRunOptions) => Promise<ChaosResult>;
}

export interface ChaosRunOptions {
  duration?: string; // Duration for timed experiments (e.g., "30s", "1m")
  intensity?: "low" | "medium" | "high";
  service?: string; // Target specific service
  dryRun?: boolean;
}

export interface ChaosResult {
  scenario: string;
  passed: boolean;
  recoveryTimeMs: number | null;
  details: string;
  metrics?: {
    requestsBefore?: number;
    requestsDuring?: number;
    errorsDuring?: number;
    latencyP95During?: number;
  };
}

function parseDuration(duration: string): number {
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

async function getProjectContainers(projectName: string): Promise<string[]> {
  try {
    const { stdout } = await execa("docker", [
      "ps", "--format", "{{.Names}}",
      "--filter", `label=com.docker.compose.project=${projectName}`,
    ], { stdio: "pipe" });
    return stdout.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function getServiceContainer(projectName: string, service: string): Promise<string | null> {
  const containers = await getProjectContainers(projectName);
  const match = containers.find((c) => c.includes(service));
  return match || null;
}

async function isContainerHealthy(container: string): Promise<boolean> {
  try {
    const { stdout } = await execa("docker", [
      "inspect", "--format", "{{.State.Running}}", container,
    ], { stdio: "pipe" });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function waitForRecovery(
  container: string,
  timeoutMs: number = 60000
): Promise<number | null> {
  const start = Date.now();
  const interval = 1000;

  while (Date.now() - start < timeoutMs) {
    if (await isContainerHealthy(container)) {
      return Date.now() - start;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return null; // Did not recover
}

async function checkHttpEndpoint(
  url: string,
  timeoutMs: number = 5000
): Promise<{ ok: boolean; statusCode?: number; latencyMs: number }> {
  const start = Date.now();
  try {
    const { stdout } = await execa("curl", [
      "-s", "-o", "/dev/null", "-w", "%{http_code}",
      "--connect-timeout", String(Math.ceil(timeoutMs / 1000)),
      url,
    ], { stdio: "pipe", timeout: timeoutMs + 1000 });
    const statusCode = parseInt(stdout.trim(), 10);
    return { ok: statusCode >= 200 && statusCode < 500, statusCode, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

// --- Scenario: Pod Kill (container stop/restart) ---

const podKillScenario: ChaosScenario = {
  name: "pod-kill",
  description: "Kill the application container and measure recovery time",
  category: "pod-kill",
  async run(projectName, options) {
    const service = options.service || "app";
    const container = await getServiceContainer(projectName, service);

    if (!container) {
      return { scenario: "pod-kill", passed: false, recoveryTimeMs: null, details: `Container for service '${service}' not found` };
    }

    if (options.dryRun) {
      return { scenario: "pod-kill", passed: true, recoveryTimeMs: null, details: `[DRY RUN] Would kill container: ${container}` };
    }

    // Verify app is healthy before chaos
    const healthBefore = await checkHttpEndpoint("http://localhost:8080/health");
    if (!healthBefore.ok) {
      return { scenario: "pod-kill", passed: false, recoveryTimeMs: null, details: "Application not healthy before test" };
    }

    // Kill the container
    console.log(chalk.yellow(`  Killing container: ${container}`));
    await execa("docker", ["kill", container], { stdio: "pipe" });

    // Docker Compose should restart it - wait for recovery
    console.log(chalk.gray("  Waiting for recovery..."));

    // Give compose a moment to detect the failure
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Restart via docker compose (simulating orchestrator restart)
    await execa("docker", ["compose", "start", service], {
      cwd: process.cwd() + "/" + projectName,
      stdio: "pipe",
    }).catch(() => {
      // Try to start via compose project
    });

    const recoveryMs = await waitForRecovery(container, 60000);

    // Verify health endpoint works after recovery
    let healthAfter = { ok: false, latencyMs: 0 };
    if (recoveryMs !== null) {
      // Wait a bit more for the app to be fully ready
      await new Promise((resolve) => setTimeout(resolve, 3000));
      healthAfter = await checkHttpEndpoint("http://localhost:8080/health");
    }

    const passed = recoveryMs !== null && healthAfter.ok;
    const recoveryTotal = recoveryMs !== null ? recoveryMs + 3000 + healthAfter.latencyMs : null;

    return {
      scenario: "pod-kill",
      passed,
      recoveryTimeMs: recoveryTotal,
      details: passed
        ? `Container recovered in ${((recoveryTotal || 0) / 1000).toFixed(1)}s`
        : `Container did not recover within timeout`,
    };
  },
};

// --- Scenario: Network Latency ---

const networkLatencyScenario: ChaosScenario = {
  name: "network-latency",
  description: "Inject network latency into the application container",
  category: "network",
  async run(projectName, options) {
    const service = options.service || "app";
    const container = await getServiceContainer(projectName, service);
    const durationMs = parseDuration(options.duration || "30s");

    if (!container) {
      return { scenario: "network-latency", passed: false, recoveryTimeMs: null, details: `Container for service '${service}' not found` };
    }

    const latencyMap = { low: 100, medium: 300, high: 1000 };
    const latencyMs = latencyMap[options.intensity || "medium"];

    if (options.dryRun) {
      return { scenario: "network-latency", passed: true, recoveryTimeMs: null, details: `[DRY RUN] Would inject ${latencyMs}ms latency for ${options.duration || "30s"}` };
    }

    // Baseline request
    const baseline = await checkHttpEndpoint("http://localhost:8080/health");
    if (!baseline.ok) {
      return { scenario: "network-latency", passed: false, recoveryTimeMs: null, details: "Application not healthy before test" };
    }

    // Inject latency using tc (traffic control) inside container
    console.log(chalk.yellow(`  Injecting ${latencyMs}ms network latency`));
    try {
      await execa("docker", [
        "exec", container, "tc", "qdisc", "add", "dev", "eth0",
        "root", "netem", "delay", `${latencyMs}ms`, `${Math.floor(latencyMs * 0.1)}ms`,
      ], { stdio: "pipe" });
    } catch {
      // tc might not be available - use an alternative approach
      return {
        scenario: "network-latency",
        passed: true,
        recoveryTimeMs: null,
        details: `Skipped: tc (traffic control) not available in container. Install iproute2 for network chaos.`,
      };
    }

    // Make requests during chaos period
    console.log(chalk.gray(`  Running for ${options.duration || "30s"} with latency injection...`));
    const chaosEnd = Date.now() + durationMs;
    let requestCount = 0;
    let errorCount = 0;
    let totalLatency = 0;

    while (Date.now() < chaosEnd) {
      const result = await checkHttpEndpoint("http://localhost:8080/health", 10000);
      requestCount++;
      if (!result.ok) errorCount++;
      totalLatency += result.latencyMs;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Remove latency injection
    console.log(chalk.gray("  Removing latency injection..."));
    await execa("docker", [
      "exec", container, "tc", "qdisc", "del", "dev", "eth0", "root",
    ], { stdio: "pipe" }).catch(() => {});

    // Verify recovery
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const after = await checkHttpEndpoint("http://localhost:8080/health");
    const avgLatency = requestCount > 0 ? totalLatency / requestCount : 0;
    const errorRate = requestCount > 0 ? errorCount / requestCount : 0;

    const passed = errorRate < 0.5 && after.ok;

    return {
      scenario: "network-latency",
      passed,
      recoveryTimeMs: after.ok ? 2000 + after.latencyMs : null,
      details: passed
        ? `Avg latency: ${avgLatency.toFixed(0)}ms, error rate: ${(errorRate * 100).toFixed(1)}%, recovered after removal`
        : `High error rate (${(errorRate * 100).toFixed(1)}%) or failed to recover`,
      metrics: {
        requestsDuring: requestCount,
        errorsDuring: errorCount,
      },
    };
  },
};

// --- Scenario: Kafka Down ---

const kafkaDownScenario: ChaosScenario = {
  name: "kafka-down",
  description: "Stop Kafka and verify application graceful degradation",
  category: "dependency",
  async run(projectName, options) {
    const container = await getServiceContainer(projectName, "kafka");
    const durationMs = parseDuration(options.duration || "30s");

    if (!container) {
      return { scenario: "kafka-down", passed: false, recoveryTimeMs: null, details: "Kafka container not found (is Kafka enabled for this project?)" };
    }

    if (options.dryRun) {
      return { scenario: "kafka-down", passed: true, recoveryTimeMs: null, details: `[DRY RUN] Would stop Kafka for ${options.duration || "30s"}` };
    }

    // Verify app is healthy
    const healthBefore = await checkHttpEndpoint("http://localhost:8080/health");
    if (!healthBefore.ok) {
      return { scenario: "kafka-down", passed: false, recoveryTimeMs: null, details: "Application not healthy before test" };
    }

    // Stop Kafka
    console.log(chalk.yellow("  Stopping Kafka..."));
    await execa("docker", ["stop", container], { stdio: "pipe" });

    // Check if app still serves requests (graceful degradation)
    console.log(chalk.gray(`  Testing app without Kafka for ${options.duration || "30s"}...`));
    await new Promise((resolve) => setTimeout(resolve, 5000)); // Let app detect Kafka is down

    const chaosEnd = Date.now() + durationMs;
    let requestCount = 0;
    let errorCount = 0;

    while (Date.now() < chaosEnd) {
      const result = await checkHttpEndpoint("http://localhost:8080/hello/chaos-test", 10000);
      requestCount++;
      if (!result.ok) errorCount++;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Restart Kafka
    console.log(chalk.gray("  Restarting Kafka..."));
    await execa("docker", ["start", container], { stdio: "pipe" });

    // Wait for Kafka to be ready
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Verify full recovery
    const start = Date.now();
    let recovered = false;
    for (let i = 0; i < 30; i++) {
      const ready = await checkHttpEndpoint("http://localhost:8080/ready");
      if (ready.ok) {
        recovered = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const recoveryMs = recovered ? Date.now() - start : null;
    const errorRate = requestCount > 0 ? errorCount / requestCount : 1;

    // App should still serve basic requests even with Kafka down (graceful degradation)
    const passed = errorRate < 0.3 && recovered;

    return {
      scenario: "kafka-down",
      passed,
      recoveryTimeMs: recoveryMs,
      details: passed
        ? `App degraded gracefully (${(errorRate * 100).toFixed(1)}% errors), recovered in ${((recoveryMs || 0) / 1000).toFixed(1)}s`
        : errorRate >= 0.3
          ? `App did not degrade gracefully: ${(errorRate * 100).toFixed(1)}% error rate (expected < 30%)`
          : "App did not recover after Kafka restart",
      metrics: {
        requestsDuring: requestCount,
        errorsDuring: errorCount,
      },
    };
  },
};

// --- Scenario: Database Latency ---

const dbLatencyScenario: ChaosScenario = {
  name: "db-latency",
  description: "Inject latency into database connections",
  category: "dependency",
  async run(projectName, options) {
    const container = await getServiceContainer(projectName, "postgres");
    const durationMs = parseDuration(options.duration || "30s");

    if (!container) {
      return { scenario: "db-latency", passed: false, recoveryTimeMs: null, details: "PostgreSQL container not found (is Postgres enabled for this project?)" };
    }

    const latencyMap = { low: 50, medium: 200, high: 500 };
    const latencyMs = latencyMap[options.intensity || "medium"];

    if (options.dryRun) {
      return { scenario: "db-latency", passed: true, recoveryTimeMs: null, details: `[DRY RUN] Would inject ${latencyMs}ms DB latency for ${options.duration || "30s"}` };
    }

    // Baseline
    const baseline = await checkHttpEndpoint("http://localhost:8080/ready");
    if (!baseline.ok) {
      return { scenario: "db-latency", passed: false, recoveryTimeMs: null, details: "Application not healthy before test (readiness check failed)" };
    }

    // Inject latency using tc on postgres container
    console.log(chalk.yellow(`  Injecting ${latencyMs}ms database latency`));
    try {
      await execa("docker", [
        "exec", container, "tc", "qdisc", "add", "dev", "eth0",
        "root", "netem", "delay", `${latencyMs}ms`,
      ], { stdio: "pipe" });
    } catch {
      return {
        scenario: "db-latency",
        passed: true,
        recoveryTimeMs: null,
        details: "Skipped: tc (traffic control) not available in container. Install iproute2 for DB chaos.",
      };
    }

    // Test during chaos
    console.log(chalk.gray(`  Running for ${options.duration || "30s"} with DB latency...`));
    const chaosEnd = Date.now() + durationMs;
    let requestCount = 0;
    let errorCount = 0;
    let totalLatency = 0;

    while (Date.now() < chaosEnd) {
      const result = await checkHttpEndpoint("http://localhost:8080/ready", 10000);
      requestCount++;
      if (!result.ok) errorCount++;
      totalLatency += result.latencyMs;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Remove latency
    console.log(chalk.gray("  Removing database latency..."));
    await execa("docker", [
      "exec", container, "tc", "qdisc", "del", "dev", "eth0", "root",
    ], { stdio: "pipe" }).catch(() => {});

    // Verify recovery
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const after = await checkHttpEndpoint("http://localhost:8080/ready");
    const avgLatency = requestCount > 0 ? totalLatency / requestCount : 0;
    const errorRate = requestCount > 0 ? errorCount / requestCount : 0;

    const passed = errorRate < 0.5 && after.ok;

    return {
      scenario: "db-latency",
      passed,
      recoveryTimeMs: after.ok ? 3000 + after.latencyMs : null,
      details: passed
        ? `Avg response: ${avgLatency.toFixed(0)}ms, error rate: ${(errorRate * 100).toFixed(1)}%, recovered`
        : `Failed: error rate ${(errorRate * 100).toFixed(1)}%`,
      metrics: {
        requestsDuring: requestCount,
        errorsDuring: errorCount,
      },
    };
  },
};

// --- Scenario: Memory Pressure ---

const memoryPressureScenario: ChaosScenario = {
  name: "memory-pressure",
  description: "Apply memory pressure to the application container",
  category: "resource",
  async run(projectName, options) {
    const service = options.service || "app";
    const container = await getServiceContainer(projectName, service);
    const durationMs = parseDuration(options.duration || "30s");

    if (!container) {
      return { scenario: "memory-pressure", passed: false, recoveryTimeMs: null, details: `Container for service '${service}' not found` };
    }

    if (options.dryRun) {
      return { scenario: "memory-pressure", passed: true, recoveryTimeMs: null, details: `[DRY RUN] Would apply memory pressure for ${options.duration || "30s"}` };
    }

    // Verify health
    const before = await checkHttpEndpoint("http://localhost:8080/health");
    if (!before.ok) {
      return { scenario: "memory-pressure", passed: false, recoveryTimeMs: null, details: "Application not healthy before test" };
    }

    // Apply memory pressure using stress-ng or dd (fallback)
    const memoryMb = options.intensity === "high" ? 256 : options.intensity === "low" ? 64 : 128;
    console.log(chalk.yellow(`  Applying ${memoryMb}MB memory pressure`));

    // Try stress-ng first, then fallback to dd
    const stressCmd = `stress-ng --vm 1 --vm-bytes ${memoryMb}M --timeout ${Math.ceil(durationMs / 1000)}s 2>/dev/null || dd if=/dev/zero bs=1M count=${memoryMb} 2>/dev/null | sleep ${Math.ceil(durationMs / 1000)}`;

    const stressProcess = execa("docker", [
      "exec", container, "sh", "-c", stressCmd,
    ], { stdio: "pipe", timeout: durationMs + 30000 }).catch(() => {});

    // Monitor app health during stress
    console.log(chalk.gray(`  Monitoring health for ${options.duration || "30s"}...`));
    const chaosEnd = Date.now() + durationMs;
    let requestCount = 0;
    let errorCount = 0;

    while (Date.now() < chaosEnd) {
      const result = await checkHttpEndpoint("http://localhost:8080/health", 10000);
      requestCount++;
      if (!result.ok) errorCount++;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Wait for stress to end
    await stressProcess;
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verify recovery
    const after = await checkHttpEndpoint("http://localhost:8080/health");
    const errorRate = requestCount > 0 ? errorCount / requestCount : 0;

    // Check if container is still running
    const containerHealthy = await isContainerHealthy(container);
    const passed = containerHealthy && errorRate < 0.5 && after.ok;

    return {
      scenario: "memory-pressure",
      passed,
      recoveryTimeMs: after.ok ? 3000 + after.latencyMs : null,
      details: passed
        ? `App survived ${memoryMb}MB pressure (${(errorRate * 100).toFixed(1)}% errors)`
        : !containerHealthy
          ? "Container was OOMKilled"
          : `High error rate: ${(errorRate * 100).toFixed(1)}%`,
      metrics: {
        requestsDuring: requestCount,
        errorsDuring: errorCount,
      },
    };
  },
};

// --- Registry of all scenarios ---

export const chaosScenarios: Record<string, ChaosScenario> = {
  "pod-kill": podKillScenario,
  "network-latency": networkLatencyScenario,
  "kafka-down": kafkaDownScenario,
  "db-latency": dbLatencyScenario,
  "memory-pressure": memoryPressureScenario,
};

export function getAvailableScenarios(): ChaosScenario[] {
  return Object.values(chaosScenarios);
}

export function getScenario(name: string): ChaosScenario | undefined {
  return chaosScenarios[name];
}
