import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import readline from "node:readline";

/**
 * Log retention and rotation settings management.
 * Persists Docker logs to files and manages rotation.
 */

export interface LogRetentionConfig {
  maxFileSizeMb: number;       // Max size per log file before rotation (default: 5MB)
  maxRetentionDays: number;    // Days to keep rotated logs (default: 7)
  maxFiles: number;            // Max number of rotated files to keep (default: 10)
  persistEnabled: boolean;     // Whether to persist logs to disk
}

export interface StoredLogEntry {
  timestamp: string;
  service: string;
  message: string;
  level?: "info" | "warn" | "error" | "debug";
}

const DATA_DIR = ".blissful-infra";
const LOGS_DIR = "logs";
const CURRENT_LOG = "current.jsonl";
const CONFIG_FILE = "log-config.json";

const DEFAULT_CONFIG: LogRetentionConfig = {
  maxFileSizeMb: 5,
  maxRetentionDays: 7,
  maxFiles: 10,
  persistEnabled: true,
};

function getLogsDir(projectDir: string): string {
  return path.join(projectDir, DATA_DIR, LOGS_DIR);
}

function getConfigPath(projectDir: string): string {
  return path.join(projectDir, DATA_DIR, CONFIG_FILE);
}

function getCurrentLogPath(projectDir: string): string {
  return path.join(getLogsDir(projectDir), CURRENT_LOG);
}

async function ensureLogsDir(projectDir: string): Promise<void> {
  await fs.mkdir(getLogsDir(projectDir), { recursive: true });
}

/**
 * Load log retention config
 */
export async function loadLogConfig(projectDir: string): Promise<LogRetentionConfig> {
  try {
    const content = await fs.readFile(getConfigPath(projectDir), "utf8");
    const saved = JSON.parse(content);
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Save log retention config
 */
export async function saveLogConfig(
  projectDir: string,
  config: LogRetentionConfig
): Promise<void> {
  await fs.mkdir(path.join(projectDir, DATA_DIR), { recursive: true });
  await fs.writeFile(getConfigPath(projectDir), JSON.stringify(config, null, 2), "utf8");
}

/**
 * Detect log level from message content
 */
function detectLevel(message: string): StoredLogEntry["level"] {
  const lower = message.toLowerCase();
  if (lower.includes("error") || lower.includes("exception") || lower.includes("fatal")) return "error";
  if (lower.includes("warn")) return "warn";
  if (lower.includes("debug") || lower.includes("trace")) return "debug";
  return "info";
}

/**
 * Persist log entries to storage
 */
export async function persistLogs(
  projectDir: string,
  entries: Array<{ timestamp: string; service: string; message: string }>
): Promise<void> {
  const config = await loadLogConfig(projectDir);
  if (!config.persistEnabled) return;

  await ensureLogsDir(projectDir);
  const logPath = getCurrentLogPath(projectDir);

  // Check if rotation is needed before writing
  await rotateIfNeeded(projectDir, config);

  // Append log entries
  const lines = entries.map((entry) => {
    const stored: StoredLogEntry = {
      ...entry,
      level: detectLevel(entry.message),
    };
    return JSON.stringify(stored);
  });

  if (lines.length > 0) {
    await fs.appendFile(logPath, lines.join("\n") + "\n", "utf8");
  }
}

/**
 * Rotate current log file if it exceeds max size
 */
async function rotateIfNeeded(
  projectDir: string,
  config: LogRetentionConfig
): Promise<void> {
  const logPath = getCurrentLogPath(projectDir);
  const maxBytes = config.maxFileSizeMb * 1024 * 1024;

  try {
    const stat = await fs.stat(logPath);
    if (stat.size >= maxBytes) {
      const timestamp = Date.now();
      const rotatedName = `log-${timestamp}.jsonl`;
      const rotatedPath = path.join(getLogsDir(projectDir), rotatedName);

      await fs.rename(logPath, rotatedPath);

      // Clean up old rotated files
      await cleanupRotatedFiles(projectDir, config);
    }
  } catch {
    // File doesn't exist, no rotation needed
  }
}

/**
 * Clean up old rotated files beyond retention limits
 */
async function cleanupRotatedFiles(
  projectDir: string,
  config: LogRetentionConfig
): Promise<void> {
  const logsDir = getLogsDir(projectDir);

  try {
    const files = await fs.readdir(logsDir);
    const rotatedFiles = files
      .filter((f) => f.startsWith("log-") && f.endsWith(".jsonl"))
      .sort()
      .reverse(); // Newest first

    const cutoffTime = Date.now() - config.maxRetentionDays * 24 * 60 * 60 * 1000;

    let kept = 0;
    for (const file of rotatedFiles) {
      const timestampMatch = file.match(/log-(\d+)\.jsonl/);
      const fileTimestamp = timestampMatch ? parseInt(timestampMatch[1], 10) : 0;

      // Remove if beyond retention period or exceeds max file count
      if (fileTimestamp < cutoffTime || kept >= config.maxFiles) {
        await fs.unlink(path.join(logsDir, file));
      } else {
        kept++;
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Search stored logs with filters
 */
export async function searchLogs(
  projectDir: string,
  options: {
    startTime?: string;
    endTime?: string;
    service?: string;
    level?: string;
    query?: string;
    limit?: number;
  } = {}
): Promise<StoredLogEntry[]> {
  const { service, level, query, limit = 500 } = options;
  const startTime = options.startTime ? new Date(options.startTime).getTime() : 0;
  const endTime = options.endTime ? new Date(options.endTime).getTime() : Date.now();
  const logsDir = getLogsDir(projectDir);
  const results: StoredLogEntry[] = [];

  try {
    const files = await fs.readdir(logsDir);
    const logFiles = files
      .filter((f) => f.endsWith(".jsonl"))
      .sort(); // Oldest first

    for (const file of logFiles) {
      const filePath = path.join(logsDir, file);
      const entries = await readLogFile(filePath);

      for (const entry of entries) {
        const entryTime = new Date(entry.timestamp).getTime();

        // Apply filters
        if (entryTime < startTime || entryTime > endTime) continue;
        if (service && entry.service !== service) continue;
        if (level && entry.level !== level) continue;
        if (query && !entry.message.toLowerCase().includes(query.toLowerCase())) continue;

        results.push(entry);
        if (results.length >= limit) break;
      }

      if (results.length >= limit) break;
    }
  } catch {
    // No logs directory
  }

  // Return most recent entries
  return results.slice(-limit);
}

/**
 * Read entries from a single log file
 */
async function readLogFile(filePath: string): Promise<StoredLogEntry[]> {
  const entries: StoredLogEntry[] = [];

  try {
    const fileStream = createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as StoredLogEntry);
      } catch {
        // Skip invalid lines
      }
    }
  } catch {
    // File read error
  }

  return entries;
}

/**
 * Get log storage statistics
 */
export async function getLogStorageStats(
  projectDir: string
): Promise<{
  totalSize: number;
  fileCount: number;
  entryCount: number;
  oldestEntry?: string;
  newestEntry?: string;
  serviceBreakdown: Record<string, number>;
  levelBreakdown: Record<string, number>;
}> {
  const logsDir = getLogsDir(projectDir);
  const stats = {
    totalSize: 0,
    fileCount: 0,
    entryCount: 0,
    oldestEntry: undefined as string | undefined,
    newestEntry: undefined as string | undefined,
    serviceBreakdown: {} as Record<string, number>,
    levelBreakdown: {} as Record<string, number>,
  };

  try {
    const files = await fs.readdir(logsDir);
    const logFiles = files.filter((f) => f.endsWith(".jsonl")).sort();
    stats.fileCount = logFiles.length;

    for (const file of logFiles) {
      const filePath = path.join(logsDir, file);
      const fileStat = await fs.stat(filePath);
      stats.totalSize += fileStat.size;

      const entries = await readLogFile(filePath);
      stats.entryCount += entries.length;

      for (const entry of entries) {
        // Track oldest/newest
        if (!stats.oldestEntry || entry.timestamp < stats.oldestEntry) {
          stats.oldestEntry = entry.timestamp;
        }
        if (!stats.newestEntry || entry.timestamp > stats.newestEntry) {
          stats.newestEntry = entry.timestamp;
        }

        // Service breakdown
        stats.serviceBreakdown[entry.service] = (stats.serviceBreakdown[entry.service] || 0) + 1;

        // Level breakdown
        const level = entry.level || "info";
        stats.levelBreakdown[level] = (stats.levelBreakdown[level] || 0) + 1;
      }
    }
  } catch {
    // No logs directory
  }

  return stats;
}

/**
 * Force rotation of the current log file
 */
export async function forceRotate(projectDir: string): Promise<void> {
  const logPath = getCurrentLogPath(projectDir);
  const config = await loadLogConfig(projectDir);

  try {
    await fs.access(logPath);
    const timestamp = Date.now();
    const rotatedPath = path.join(getLogsDir(projectDir), `log-${timestamp}.jsonl`);
    await fs.rename(logPath, rotatedPath);
    await cleanupRotatedFiles(projectDir, config);
  } catch {
    // No current log to rotate
  }
}

/**
 * Clear all stored logs
 */
export async function clearLogs(projectDir: string): Promise<void> {
  const logsDir = getLogsDir(projectDir);

  try {
    const files = await fs.readdir(logsDir);
    for (const file of files) {
      if (file.endsWith(".jsonl")) {
        await fs.unlink(path.join(logsDir, file));
      }
    }
  } catch {
    // No logs to clear
  }
}
