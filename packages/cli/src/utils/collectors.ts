import { execa } from "execa";
import path from "node:path";

export interface LogEntry {
  timestamp: string;
  service: string;
  message: string;
}

export interface GitCommit {
  sha: string;
  author: string;
  date: string;
  message: string;
}

export interface CollectedContext {
  logs: LogEntry[];
  commits: GitCommit[];
  summary: string;
}

/**
 * Collect Docker Compose logs from a project
 */
export async function collectDockerLogs(
  projectDir: string,
  options: { tail?: number; service?: string } = {}
): Promise<LogEntry[]> {
  const { tail = 100, service } = options;

  try {
    const args = ["compose", "logs", `--tail=${tail}`, "--no-color"];
    if (service) {
      args.push(service);
    }

    const { stdout } = await execa("docker", args, {
      cwd: projectDir,
      reject: false,
    });

    return parseDockerLogs(stdout);
  } catch {
    return [];
  }
}

/**
 * Parse Docker Compose logs into structured format
 */
function parseDockerLogs(output: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const lines = output.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    // Docker compose log format: "service-name  | log message"
    const match = line.match(/^([^\s|]+)\s*\|\s*(.*)$/);
    if (match) {
      const [, service, message] = match;

      // Try to extract timestamp from message
      const timestampMatch = message.match(
        /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*)\s*/
      );
      const timestamp = timestampMatch ? timestampMatch[1] : new Date().toISOString();
      const cleanMessage = timestampMatch
        ? message.slice(timestampMatch[0].length)
        : message;

      entries.push({
        timestamp,
        service: service.trim(),
        message: cleanMessage.trim(),
      });
    } else if (line.trim()) {
      // Line without service prefix
      entries.push({
        timestamp: new Date().toISOString(),
        service: "unknown",
        message: line.trim(),
      });
    }
  }

  return entries;
}

/**
 * Collect recent git commits from a repository
 */
export async function collectGitCommits(
  repoDir: string,
  options: { limit?: number; since?: string } = {}
): Promise<GitCommit[]> {
  const { limit = 10, since } = options;

  try {
    const args = [
      "log",
      `--max-count=${limit}`,
      "--format=%H|%an|%aI|%s",
    ];

    if (since) {
      args.push(`--since=${since}`);
    }

    const { stdout } = await execa("git", args, {
      cwd: repoDir,
      reject: false,
    });

    return parseGitLog(stdout);
  } catch {
    return [];
  }
}

/**
 * Parse git log output into structured format
 */
function parseGitLog(output: string): GitCommit[] {
  const commits: GitCommit[] = [];
  const lines = output.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length >= 4) {
      commits.push({
        sha: parts[0],
        author: parts[1],
        date: parts[2],
        message: parts.slice(3).join("|"), // Handle | in commit messages
      });
    }
  }

  return commits;
}

/**
 * Get git diff for a specific commit
 */
export async function getGitDiff(
  repoDir: string,
  sha: string
): Promise<string> {
  try {
    const { stdout } = await execa("git", ["show", sha, "--stat"], {
      cwd: repoDir,
      reject: false,
    });
    return stdout;
  } catch {
    return "";
  }
}

/**
 * Collect all context for agent analysis
 */
export async function collectContext(
  projectDir: string,
  options: {
    logTail?: number;
    commitLimit?: number;
    service?: string;
  } = {}
): Promise<CollectedContext> {
  const { logTail = 100, commitLimit = 10, service } = options;

  // Collect in parallel
  const [logs, commits] = await Promise.all([
    collectDockerLogs(projectDir, { tail: logTail, service }),
    collectGitCommits(projectDir, { limit: commitLimit }),
  ]);

  // Generate summary
  const errorLogs = logs.filter(
    (l) =>
      l.message.toLowerCase().includes("error") ||
      l.message.toLowerCase().includes("exception") ||
      l.message.toLowerCase().includes("failed")
  );

  const summary = [
    `Collected ${logs.length} log entries from Docker containers.`,
    errorLogs.length > 0
      ? `Found ${errorLogs.length} entries containing errors/exceptions.`
      : "No obvious errors found in logs.",
    `Collected ${commits.length} recent git commits.`,
  ].join(" ");

  return { logs, commits, summary };
}

/**
 * Format context for LLM prompt
 */
export function formatContextForPrompt(context: CollectedContext): string {
  const sections: string[] = [];

  // Recent logs section
  if (context.logs.length > 0) {
    const logLines = context.logs
      .slice(-50) // Last 50 entries
      .map((l) => `[${l.service}] ${l.message}`)
      .join("\n");

    sections.push(`## Recent Logs\n\`\`\`\n${logLines}\n\`\`\``);
  }

  // Recent commits section
  if (context.commits.length > 0) {
    const commitLines = context.commits
      .map((c) => `- ${c.sha.slice(0, 7)} (${c.author}): ${c.message}`)
      .join("\n");

    sections.push(`## Recent Commits\n${commitLines}`);
  }

  return sections.join("\n\n");
}
