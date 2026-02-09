import fs from "node:fs/promises";
import path from "node:path";
import { existsSync, createWriteStream, createReadStream } from "node:fs";
import readline from "node:readline";

/**
 * Metrics storage using JSON Lines format for efficient append-only storage.
 * Each line is a complete JSON object representing a metrics snapshot.
 */

export interface StoredMetrics {
  timestamp: number;
  projectName: string;
  containers: ContainerMetricsData[];
  http?: HttpMetricsData;
}

export interface ContainerMetricsData {
  name: string;
  cpuPercent: number;
  memoryPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  networkRx: number;
  networkTx: number;
}

export interface HttpMetricsData {
  totalRequests: number;
  avgResponseTime: number;
  p50Latency?: number;
  p95Latency?: number;
  p99Latency?: number;
  errorRate?: number;
  status2xx?: number;
  status4xx?: number;
  status5xx?: number;
}

const DATA_DIR = ".blissful-infra";
const METRICS_FILE = "metrics.jsonl";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB max file size before rotation
const MAX_RETENTION_DAYS = 7; // Keep metrics for 7 days

/**
 * Get the metrics storage directory for a project
 */
function getMetricsDir(projectDir: string): string {
  return path.join(projectDir, DATA_DIR);
}

/**
 * Get the metrics file path for a project
 */
function getMetricsFilePath(projectDir: string): string {
  return path.join(getMetricsDir(projectDir), METRICS_FILE);
}

/**
 * Ensure the metrics directory exists
 */
async function ensureMetricsDir(projectDir: string): Promise<void> {
  const metricsDir = getMetricsDir(projectDir);
  await fs.mkdir(metricsDir, { recursive: true });
}

/**
 * Save metrics to storage
 */
export async function saveMetrics(
  projectDir: string,
  projectName: string,
  containers: ContainerMetricsData[],
  http?: HttpMetricsData
): Promise<void> {
  await ensureMetricsDir(projectDir);
  const filePath = getMetricsFilePath(projectDir);

  const metrics: StoredMetrics = {
    timestamp: Date.now(),
    projectName,
    containers,
    http,
  };

  // Check if rotation is needed
  await rotateIfNeeded(filePath);

  // Append metrics as JSON line
  const line = JSON.stringify(metrics) + "\n";
  await fs.appendFile(filePath, line, "utf8");
}

/**
 * Rotate metrics file if it exceeds max size
 */
async function rotateIfNeeded(filePath: string): Promise<void> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      const rotatedPath = filePath.replace(".jsonl", `.${Date.now()}.jsonl`);
      await fs.rename(filePath, rotatedPath);

      // Clean up old rotated files
      await cleanupOldFiles(path.dirname(filePath));
    }
  } catch {
    // File doesn't exist yet, no rotation needed
  }
}

/**
 * Clean up old rotated files beyond retention period
 */
async function cleanupOldFiles(metricsDir: string): Promise<void> {
  try {
    const files = await fs.readdir(metricsDir);
    const cutoffTime = Date.now() - MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (file.startsWith("metrics.") && file.endsWith(".jsonl") && file !== METRICS_FILE) {
        // Extract timestamp from filename (metrics.1234567890.jsonl)
        const timestampMatch = file.match(/metrics\.(\d+)\.jsonl/);
        if (timestampMatch) {
          const fileTimestamp = parseInt(timestampMatch[1], 10);
          if (fileTimestamp < cutoffTime) {
            await fs.unlink(path.join(metricsDir, file));
          }
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Load historical metrics within a time range
 */
export async function loadMetrics(
  projectDir: string,
  options: {
    startTime?: number;
    endTime?: number;
    limit?: number;
  } = {}
): Promise<StoredMetrics[]> {
  const { startTime = 0, endTime = Date.now(), limit = 1000 } = options;
  const metricsDir = getMetricsDir(projectDir);
  const metrics: StoredMetrics[] = [];

  try {
    const files = await fs.readdir(metricsDir);
    const metricsFiles = files
      .filter((f) => f.startsWith("metrics") && f.endsWith(".jsonl"))
      .sort(); // Sort to get oldest first

    for (const file of metricsFiles) {
      const filePath = path.join(metricsDir, file);
      const fileMetrics = await readMetricsFile(filePath, startTime, endTime);
      metrics.push(...fileMetrics);

      if (metrics.length >= limit) {
        break;
      }
    }
  } catch {
    // No metrics directory or files
  }

  // Return most recent metrics up to limit, sorted by timestamp
  return metrics
    .filter((m) => m.timestamp >= startTime && m.timestamp <= endTime)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-limit);
}

/**
 * Read metrics from a single file
 */
async function readMetricsFile(
  filePath: string,
  startTime: number,
  endTime: number
): Promise<StoredMetrics[]> {
  const metrics: StoredMetrics[] = [];

  try {
    const fileStream = createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const metric = JSON.parse(line) as StoredMetrics;
        if (metric.timestamp >= startTime && metric.timestamp <= endTime) {
          metrics.push(metric);
        }
      } catch {
        // Skip invalid lines
      }
    }
  } catch {
    // File read error
  }

  return metrics;
}

/**
 * Get aggregated metrics summary for a time period
 */
export async function getMetricsSummary(
  projectDir: string,
  options: {
    startTime?: number;
    endTime?: number;
  } = {}
): Promise<{
  dataPoints: number;
  timeRange: { start: number; end: number };
  containers: Record<
    string,
    {
      avgCpu: number;
      maxCpu: number;
      avgMemory: number;
      maxMemory: number;
    }
  >;
  http?: {
    totalRequests: number;
    avgResponseTime: number;
    avgErrorRate: number;
    avgP50: number;
    avgP95: number;
    avgP99: number;
  };
}> {
  const metrics = await loadMetrics(projectDir, options);

  if (metrics.length === 0) {
    return {
      dataPoints: 0,
      timeRange: { start: 0, end: 0 },
      containers: {},
    };
  }

  const containers: Record<
    string,
    { cpuSum: number; cpuMax: number; memSum: number; memMax: number; count: number }
  > = {};
  let httpSum = {
    count: 0,
    responseTime: 0,
    errorRate: 0,
    p50: 0,
    p95: 0,
    p99: 0,
  };
  let lastTotalRequests = 0;

  for (const m of metrics) {
    // Aggregate container metrics
    for (const c of m.containers) {
      if (!containers[c.name]) {
        containers[c.name] = { cpuSum: 0, cpuMax: 0, memSum: 0, memMax: 0, count: 0 };
      }
      containers[c.name].cpuSum += c.cpuPercent;
      containers[c.name].cpuMax = Math.max(containers[c.name].cpuMax, c.cpuPercent);
      containers[c.name].memSum += c.memoryPercent;
      containers[c.name].memMax = Math.max(containers[c.name].memMax, c.memoryPercent);
      containers[c.name].count++;
    }

    // Aggregate HTTP metrics
    if (m.http) {
      httpSum.count++;
      httpSum.responseTime += m.http.avgResponseTime || 0;
      httpSum.errorRate += m.http.errorRate || 0;
      httpSum.p50 += m.http.p50Latency || 0;
      httpSum.p95 += m.http.p95Latency || 0;
      httpSum.p99 += m.http.p99Latency || 0;
      lastTotalRequests = m.http.totalRequests;
    }
  }

  return {
    dataPoints: metrics.length,
    timeRange: {
      start: metrics[0].timestamp,
      end: metrics[metrics.length - 1].timestamp,
    },
    containers: Object.fromEntries(
      Object.entries(containers).map(([name, data]) => [
        name,
        {
          avgCpu: data.cpuSum / data.count,
          maxCpu: data.cpuMax,
          avgMemory: data.memSum / data.count,
          maxMemory: data.memMax,
        },
      ])
    ),
    http:
      httpSum.count > 0
        ? {
            totalRequests: lastTotalRequests,
            avgResponseTime: httpSum.responseTime / httpSum.count,
            avgErrorRate: httpSum.errorRate / httpSum.count,
            avgP50: httpSum.p50 / httpSum.count,
            avgP95: httpSum.p95 / httpSum.count,
            avgP99: httpSum.p99 / httpSum.count,
          }
        : undefined,
  };
}

/**
 * Export metrics to JSON format
 */
export async function exportMetricsToJson(
  projectDir: string,
  outputPath: string,
  options: { startTime?: number; endTime?: number } = {}
): Promise<number> {
  const metrics = await loadMetrics(projectDir, { ...options, limit: 100000 });

  await fs.writeFile(outputPath, JSON.stringify(metrics, null, 2), "utf8");
  return metrics.length;
}

/**
 * Export metrics to CSV format
 */
export async function exportMetricsToCsv(
  projectDir: string,
  outputPath: string,
  options: { startTime?: number; endTime?: number } = {}
): Promise<number> {
  const metrics = await loadMetrics(projectDir, { ...options, limit: 100000 });

  if (metrics.length === 0) {
    await fs.writeFile(outputPath, "", "utf8");
    return 0;
  }

  // Build CSV header
  const headers = [
    "timestamp",
    "datetime",
    "projectName",
    "containerName",
    "cpuPercent",
    "memoryPercent",
    "memoryUsage",
    "memoryLimit",
    "networkRx",
    "networkTx",
    "httpTotalRequests",
    "httpAvgResponseTime",
    "httpP50",
    "httpP95",
    "httpP99",
    "httpErrorRate",
    "http2xx",
    "http4xx",
    "http5xx",
  ];

  const lines: string[] = [headers.join(",")];

  for (const m of metrics) {
    const datetime = new Date(m.timestamp).toISOString();

    // One row per container
    for (const c of m.containers) {
      const row = [
        m.timestamp,
        datetime,
        m.projectName,
        c.name,
        c.cpuPercent.toFixed(2),
        c.memoryPercent.toFixed(2),
        c.memoryUsage,
        c.memoryLimit,
        c.networkRx,
        c.networkTx,
        m.http?.totalRequests || "",
        m.http?.avgResponseTime?.toFixed(2) || "",
        m.http?.p50Latency?.toFixed(2) || "",
        m.http?.p95Latency?.toFixed(2) || "",
        m.http?.p99Latency?.toFixed(2) || "",
        m.http?.errorRate?.toFixed(4) || "",
        m.http?.status2xx || "",
        m.http?.status4xx || "",
        m.http?.status5xx || "",
      ];
      lines.push(row.join(","));
    }

    // If no containers but have HTTP metrics, still output a row
    if (m.containers.length === 0 && m.http) {
      const row = [
        m.timestamp,
        datetime,
        m.projectName,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        m.http.totalRequests,
        m.http.avgResponseTime?.toFixed(2) || "",
        m.http.p50Latency?.toFixed(2) || "",
        m.http.p95Latency?.toFixed(2) || "",
        m.http.p99Latency?.toFixed(2) || "",
        m.http.errorRate?.toFixed(4) || "",
        m.http.status2xx || "",
        m.http.status4xx || "",
        m.http.status5xx || "",
      ];
      lines.push(row.join(","));
    }
  }

  await fs.writeFile(outputPath, lines.join("\n"), "utf8");
  return metrics.length;
}

/**
 * Clear all stored metrics for a project
 */
export async function clearMetrics(projectDir: string): Promise<void> {
  const metricsDir = getMetricsDir(projectDir);

  try {
    const files = await fs.readdir(metricsDir);
    for (const file of files) {
      if (file.startsWith("metrics") && file.endsWith(".jsonl")) {
        await fs.unlink(path.join(metricsDir, file));
      }
    }
  } catch {
    // No metrics to clear
  }
}

/**
 * Get storage info (file sizes, data point count, etc.)
 */
export async function getStorageInfo(
  projectDir: string
): Promise<{
  totalSize: number;
  fileCount: number;
  oldestTimestamp?: number;
  newestTimestamp?: number;
}> {
  const metricsDir = getMetricsDir(projectDir);

  try {
    const files = await fs.readdir(metricsDir);
    const metricsFiles = files.filter(
      (f) => f.startsWith("metrics") && f.endsWith(".jsonl")
    );

    let totalSize = 0;
    let oldestTimestamp: number | undefined;
    let newestTimestamp: number | undefined;

    for (const file of metricsFiles) {
      const filePath = path.join(metricsDir, file);
      const stat = await fs.stat(filePath);
      totalSize += stat.size;

      // Read first and last line to get time range
      const metrics = await readMetricsFile(filePath, 0, Date.now());
      if (metrics.length > 0) {
        const first = metrics[0].timestamp;
        const last = metrics[metrics.length - 1].timestamp;

        if (!oldestTimestamp || first < oldestTimestamp) {
          oldestTimestamp = first;
        }
        if (!newestTimestamp || last > newestTimestamp) {
          newestTimestamp = last;
        }
      }
    }

    return {
      totalSize,
      fileCount: metricsFiles.length,
      oldestTimestamp,
      newestTimestamp,
    };
  } catch {
    return {
      totalSize: 0,
      fileCount: 0,
    };
  }
}
