import fs from "node:fs/promises";
import path from "node:path";

/**
 * Alert thresholds and triggered alerts management
 */

export interface AlertThreshold {
  id: string;
  name: string;
  metric: "cpu" | "memory" | "errorRate" | "p95Latency" | "p99Latency";
  operator: ">" | "<" | ">=" | "<=";
  value: number;
  container?: string; // Optional: specific container (for cpu/memory)
  enabled: boolean;
  severity: "warning" | "critical";
}

export interface TriggeredAlert {
  id: string;
  thresholdId: string;
  name: string;
  metric: string;
  value: number;
  threshold: number;
  severity: "warning" | "critical";
  triggeredAt: number;
  resolvedAt?: number;
  container?: string;
}

export interface AlertsConfig {
  thresholds: AlertThreshold[];
  notifyOnConsole: boolean;
  cooldownMs: number; // Don't re-trigger same alert within this period
}

export interface AlertsState {
  activeAlerts: TriggeredAlert[];
  alertHistory: TriggeredAlert[];
}

const DATA_DIR = ".blissful-infra";
const ALERTS_CONFIG_FILE = "alerts.json";
const ALERTS_STATE_FILE = "alerts-state.json";

const DEFAULT_THRESHOLDS: AlertThreshold[] = [
  {
    id: "cpu-high",
    name: "High CPU Usage",
    metric: "cpu",
    operator: ">",
    value: 80,
    enabled: true,
    severity: "warning",
  },
  {
    id: "cpu-critical",
    name: "Critical CPU Usage",
    metric: "cpu",
    operator: ">",
    value: 95,
    enabled: true,
    severity: "critical",
  },
  {
    id: "memory-high",
    name: "High Memory Usage",
    metric: "memory",
    operator: ">",
    value: 80,
    enabled: true,
    severity: "warning",
  },
  {
    id: "memory-critical",
    name: "Critical Memory Usage",
    metric: "memory",
    operator: ">",
    value: 95,
    enabled: true,
    severity: "critical",
  },
  {
    id: "error-rate-warning",
    name: "Elevated Error Rate",
    metric: "errorRate",
    operator: ">",
    value: 1,
    enabled: true,
    severity: "warning",
  },
  {
    id: "error-rate-critical",
    name: "High Error Rate",
    metric: "errorRate",
    operator: ">",
    value: 5,
    enabled: true,
    severity: "critical",
  },
  {
    id: "p95-latency-warning",
    name: "High p95 Latency",
    metric: "p95Latency",
    operator: ">",
    value: 500, // 500ms
    enabled: true,
    severity: "warning",
  },
  {
    id: "p99-latency-warning",
    name: "High p99 Latency",
    metric: "p99Latency",
    operator: ">",
    value: 1000, // 1s
    enabled: true,
    severity: "warning",
  },
];

const DEFAULT_CONFIG: AlertsConfig = {
  thresholds: DEFAULT_THRESHOLDS,
  notifyOnConsole: true,
  cooldownMs: 60000, // 1 minute cooldown
};

function getAlertsDir(projectDir: string): string {
  return path.join(projectDir, DATA_DIR);
}

function getConfigPath(projectDir: string): string {
  return path.join(getAlertsDir(projectDir), ALERTS_CONFIG_FILE);
}

function getStatePath(projectDir: string): string {
  return path.join(getAlertsDir(projectDir), ALERTS_STATE_FILE);
}

async function ensureDir(projectDir: string): Promise<void> {
  await fs.mkdir(getAlertsDir(projectDir), { recursive: true });
}

/**
 * Load alerts configuration, creating defaults if not exists
 */
export async function loadAlertsConfig(projectDir: string): Promise<AlertsConfig> {
  try {
    const content = await fs.readFile(getConfigPath(projectDir), "utf8");
    return JSON.parse(content);
  } catch {
    // Return default config
    return DEFAULT_CONFIG;
  }
}

/**
 * Save alerts configuration
 */
export async function saveAlertsConfig(
  projectDir: string,
  config: AlertsConfig
): Promise<void> {
  await ensureDir(projectDir);
  await fs.writeFile(getConfigPath(projectDir), JSON.stringify(config, null, 2), "utf8");
}

/**
 * Load alerts state (active and historical alerts)
 */
export async function loadAlertsState(projectDir: string): Promise<AlertsState> {
  try {
    const content = await fs.readFile(getStatePath(projectDir), "utf8");
    return JSON.parse(content);
  } catch {
    return { activeAlerts: [], alertHistory: [] };
  }
}

/**
 * Save alerts state
 */
async function saveAlertsState(projectDir: string, state: AlertsState): Promise<void> {
  await ensureDir(projectDir);
  // Keep only last 100 historical alerts
  state.alertHistory = state.alertHistory.slice(-100);
  await fs.writeFile(getStatePath(projectDir), JSON.stringify(state, null, 2), "utf8");
}

/**
 * Check if a threshold condition is met
 */
function checkThreshold(threshold: AlertThreshold, value: number): boolean {
  switch (threshold.operator) {
    case ">":
      return value > threshold.value;
    case "<":
      return value < threshold.value;
    case ">=":
      return value >= threshold.value;
    case "<=":
      return value <= threshold.value;
    default:
      return false;
  }
}

export interface MetricsSnapshot {
  containers: Array<{
    name: string;
    cpuPercent: number;
    memoryPercent: number;
  }>;
  http?: {
    errorRate?: number;
    p95Latency?: number;
    p99Latency?: number;
  };
}

/**
 * Check metrics against thresholds and update alerts
 */
export async function checkAlerts(
  projectDir: string,
  metrics: MetricsSnapshot
): Promise<TriggeredAlert[]> {
  const config = await loadAlertsConfig(projectDir);
  const state = await loadAlertsState(projectDir);
  const now = Date.now();
  const newAlerts: TriggeredAlert[] = [];

  // Helper to check if alert is in cooldown
  const isInCooldown = (thresholdId: string, container?: string): boolean => {
    const recentAlert = [...state.activeAlerts, ...state.alertHistory]
      .filter((a) => a.thresholdId === thresholdId && a.container === container)
      .sort((a, b) => b.triggeredAt - a.triggeredAt)[0];

    if (!recentAlert) return false;
    return now - recentAlert.triggeredAt < config.cooldownMs;
  };

  // Helper to trigger or update alert
  const processAlert = (
    threshold: AlertThreshold,
    value: number,
    container?: string
  ) => {
    const triggered = checkThreshold(threshold, value);
    const existingAlert = state.activeAlerts.find(
      (a) => a.thresholdId === threshold.id && a.container === container
    );

    if (triggered) {
      if (!existingAlert && !isInCooldown(threshold.id, container)) {
        // New alert
        const alert: TriggeredAlert = {
          id: `${threshold.id}-${now}`,
          thresholdId: threshold.id,
          name: threshold.name,
          metric: threshold.metric,
          value,
          threshold: threshold.value,
          severity: threshold.severity,
          triggeredAt: now,
          container,
        };
        state.activeAlerts.push(alert);
        newAlerts.push(alert);

        if (config.notifyOnConsole) {
          const containerInfo = container ? ` [${container}]` : "";
          const icon = threshold.severity === "critical" ? "🚨" : "⚠️";
          console.log(
            `${icon} ALERT: ${threshold.name}${containerInfo} - ${threshold.metric} is ${value.toFixed(2)} (threshold: ${threshold.operator} ${threshold.value})`
          );
        }
      }
    } else if (existingAlert) {
      // Resolve alert
      existingAlert.resolvedAt = now;
      state.alertHistory.push(existingAlert);
      state.activeAlerts = state.activeAlerts.filter((a) => a.id !== existingAlert.id);

      if (config.notifyOnConsole) {
        const containerInfo = container ? ` [${container}]` : "";
        console.log(`✅ RESOLVED: ${threshold.name}${containerInfo}`);
      }
    }
  };

  // Check each enabled threshold
  for (const threshold of config.thresholds) {
    if (!threshold.enabled) continue;

    switch (threshold.metric) {
      case "cpu":
        for (const container of metrics.containers) {
          if (threshold.container && threshold.container !== container.name) continue;
          processAlert(threshold, container.cpuPercent, container.name);
        }
        break;

      case "memory":
        for (const container of metrics.containers) {
          if (threshold.container && threshold.container !== container.name) continue;
          processAlert(threshold, container.memoryPercent, container.name);
        }
        break;

      case "errorRate":
        if (metrics.http?.errorRate !== undefined) {
          processAlert(threshold, metrics.http.errorRate);
        }
        break;

      case "p95Latency":
        if (metrics.http?.p95Latency !== undefined) {
          processAlert(threshold, metrics.http.p95Latency);
        }
        break;

      case "p99Latency":
        if (metrics.http?.p99Latency !== undefined) {
          processAlert(threshold, metrics.http.p99Latency);
        }
        break;
    }
  }

  // Save updated state
  await saveAlertsState(projectDir, state);

  return newAlerts;
}

/**
 * Get current active alerts
 */
export async function getActiveAlerts(projectDir: string): Promise<TriggeredAlert[]> {
  const state = await loadAlertsState(projectDir);
  return state.activeAlerts;
}

/**
 * Get alert history
 */
export async function getAlertHistory(
  projectDir: string,
  limit = 50
): Promise<TriggeredAlert[]> {
  const state = await loadAlertsState(projectDir);
  return state.alertHistory.slice(-limit);
}

/**
 * Add a new alert threshold
 */
export async function addThreshold(
  projectDir: string,
  threshold: Omit<AlertThreshold, "id">
): Promise<AlertThreshold> {
  const config = await loadAlertsConfig(projectDir);
  const newThreshold: AlertThreshold = {
    ...threshold,
    id: `custom-${Date.now()}`,
  };
  config.thresholds.push(newThreshold);
  await saveAlertsConfig(projectDir, config);
  return newThreshold;
}

/**
 * Update an existing threshold
 */
export async function updateThreshold(
  projectDir: string,
  id: string,
  updates: Partial<AlertThreshold>
): Promise<boolean> {
  const config = await loadAlertsConfig(projectDir);
  const index = config.thresholds.findIndex((t) => t.id === id);
  if (index === -1) return false;

  config.thresholds[index] = { ...config.thresholds[index], ...updates };
  await saveAlertsConfig(projectDir, config);
  return true;
}

/**
 * Delete a threshold
 */
export async function deleteThreshold(projectDir: string, id: string): Promise<boolean> {
  const config = await loadAlertsConfig(projectDir);
  const initialLength = config.thresholds.length;
  config.thresholds = config.thresholds.filter((t) => t.id !== id);

  if (config.thresholds.length < initialLength) {
    await saveAlertsConfig(projectDir, config);
    return true;
  }
  return false;
}

/**
 * Clear all active alerts (acknowledge)
 */
export async function acknowledgeAlerts(projectDir: string): Promise<number> {
  const state = await loadAlertsState(projectDir);
  const count = state.activeAlerts.length;

  // Move all active alerts to history as acknowledged
  for (const alert of state.activeAlerts) {
    alert.resolvedAt = Date.now();
    state.alertHistory.push(alert);
  }
  state.activeAlerts = [];

  await saveAlertsState(projectDir, state);
  return count;
}

/**
 * Initialize alerts with default thresholds
 */
export async function initializeAlerts(projectDir: string): Promise<void> {
  await ensureDir(projectDir);
  const configPath = getConfigPath(projectDir);

  try {
    await fs.access(configPath);
    // Config already exists
  } catch {
    // Create default config
    await saveAlertsConfig(projectDir, DEFAULT_CONFIG);
  }
}
