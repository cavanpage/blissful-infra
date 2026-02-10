import fs from "node:fs/promises";
import path from "node:path";

/**
 * Knowledge base for storing incidents, patterns, and fix outcomes.
 * Uses JSON file storage (upgradeable to SQLite later).
 */

// --- Types ---

export interface Incident {
  id: string;
  timestamp: string;
  project: string;
  type: "deployment-failure" | "performance-degradation" | "crash" | "error-spike" | "resource-exhaustion" | "dependency-failure" | "custom";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  rootCause?: string;
  resolution?: string;
  status: "open" | "investigating" | "resolved" | "dismissed";
  sources: IncidentSource[];
  tags: string[];
  relatedIncidents?: string[];
  fix?: FixRecord;
  createdAt: string;
  resolvedAt?: string;
}

export interface IncidentSource {
  type: "logs" | "metrics" | "git" | "kubernetes" | "chaos" | "perf" | "manual";
  summary: string;
  data?: Record<string, unknown>;
}

export interface Pattern {
  id: string;
  name: string;
  description: string;
  category: "deployment" | "performance" | "reliability" | "security" | "resource" | "configuration";
  symptoms: string[];
  rootCauses: string[];
  fixes: string[];
  occurrences: number;
  lastSeen?: string;
  successRate: number; // 0-1, how often fixes work
  confidence: number;  // 0-1, how confident in pattern match
}

export interface FixRecord {
  id: string;
  incidentId: string;
  description: string;
  type: "code-change" | "config-change" | "infrastructure" | "rollback" | "manual";
  outcome: "resolved" | "partial" | "failed" | "pending";
  appliedAt: string;
  resolvedAt?: string;
  diff?: string;
  prUrl?: string;
}

export interface KnowledgeBaseStats {
  incidents: { total: number; open: number; resolved: number; byType: Record<string, number> };
  patterns: { total: number; byCategory: Record<string, number> };
  fixes: { total: number; resolved: number; successRate: number };
}

// --- Storage ---

const DATA_DIR = ".blissful-infra";
const KB_DIR = "knowledge-base";
const INCIDENTS_FILE = "incidents.json";
const PATTERNS_FILE = "patterns.json";

function getKbDir(projectDir: string): string {
  return path.join(projectDir, DATA_DIR, KB_DIR);
}

function getIncidentsPath(projectDir: string): string {
  return path.join(getKbDir(projectDir), INCIDENTS_FILE);
}

function getPatternsPath(projectDir: string): string {
  return path.join(getKbDir(projectDir), PATTERNS_FILE);
}

async function ensureKbDir(projectDir: string): Promise<void> {
  await fs.mkdir(getKbDir(projectDir), { recursive: true });
}

// --- Incident Management ---

export async function loadIncidents(projectDir: string): Promise<Incident[]> {
  try {
    const content = await fs.readFile(getIncidentsPath(projectDir), "utf8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveIncidents(projectDir: string, incidents: Incident[]): Promise<void> {
  await ensureKbDir(projectDir);
  await fs.writeFile(getIncidentsPath(projectDir), JSON.stringify(incidents, null, 2), "utf8");
}

function generateId(): string {
  return `inc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function recordIncident(
  projectDir: string,
  incident: Omit<Incident, "id" | "createdAt" | "status">
): Promise<Incident> {
  const incidents = await loadIncidents(projectDir);

  const newIncident: Incident = {
    ...incident,
    id: generateId(),
    status: "open",
    createdAt: new Date().toISOString(),
  };

  incidents.push(newIncident);
  await saveIncidents(projectDir, incidents);

  // Try to match against known patterns
  await matchPatterns(projectDir, newIncident);

  return newIncident;
}

export async function updateIncident(
  projectDir: string,
  id: string,
  updates: Partial<Incident>
): Promise<Incident | null> {
  const incidents = await loadIncidents(projectDir);
  const index = incidents.findIndex((i) => i.id === id);
  if (index === -1) return null;

  incidents[index] = { ...incidents[index], ...updates };

  if (updates.status === "resolved" && !incidents[index].resolvedAt) {
    incidents[index].resolvedAt = new Date().toISOString();
  }

  await saveIncidents(projectDir, incidents);
  return incidents[index];
}

export async function getIncident(projectDir: string, id: string): Promise<Incident | null> {
  const incidents = await loadIncidents(projectDir);
  return incidents.find((i) => i.id === id) || null;
}

export async function searchIncidents(
  projectDir: string,
  options: {
    type?: string;
    status?: string;
    severity?: string;
    query?: string;
    tags?: string[];
    limit?: number;
  } = {}
): Promise<Incident[]> {
  const { type, status, severity, query, tags, limit = 50 } = options;
  let incidents = await loadIncidents(projectDir);

  if (type) incidents = incidents.filter((i) => i.type === type);
  if (status) incidents = incidents.filter((i) => i.status === status);
  if (severity) incidents = incidents.filter((i) => i.severity === severity);
  if (tags && tags.length > 0) {
    incidents = incidents.filter((i) => tags.some((t) => i.tags.includes(t)));
  }
  if (query) {
    const q = query.toLowerCase();
    incidents = incidents.filter((i) =>
      i.title.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      (i.rootCause && i.rootCause.toLowerCase().includes(q))
    );
  }

  // Return newest first
  return incidents.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

// --- Pattern Management ---

export async function loadPatterns(projectDir: string): Promise<Pattern[]> {
  try {
    const content = await fs.readFile(getPatternsPath(projectDir), "utf8");
    return JSON.parse(content);
  } catch {
    return getBuiltinPatterns();
  }
}

async function savePatterns(projectDir: string, patterns: Pattern[]): Promise<void> {
  await ensureKbDir(projectDir);
  await fs.writeFile(getPatternsPath(projectDir), JSON.stringify(patterns, null, 2), "utf8");
}

function getBuiltinPatterns(): Pattern[] {
  return [
    {
      id: "pat-oom-killed",
      name: "OOMKilled Container",
      description: "Container killed due to exceeding memory limits",
      category: "resource",
      symptoms: ["OOMKilled", "memory limit", "container killed", "exit code 137"],
      rootCauses: ["Memory leak", "Insufficient memory limits", "Unbounded cache", "Large data processing"],
      fixes: [
        "Increase container memory limits",
        "Add JVM heap bounds (-Xmx)",
        "Implement bounded caches with eviction",
        "Profile memory usage to find leaks",
      ],
      occurrences: 0,
      successRate: 0.85,
      confidence: 0.9,
    },
    {
      id: "pat-connection-refused",
      name: "Connection Refused",
      description: "Service cannot connect to a dependency",
      category: "reliability",
      symptoms: ["connection refused", "ECONNREFUSED", "Connection reset", "timeout"],
      rootCauses: ["Dependency not running", "Network misconfiguration", "Port conflict", "Firewall rules"],
      fixes: [
        "Check dependency health and restart if needed",
        "Verify network configuration and service discovery",
        "Add retry logic with exponential backoff",
        "Implement circuit breaker pattern",
      ],
      occurrences: 0,
      successRate: 0.9,
      confidence: 0.85,
    },
    {
      id: "pat-slow-queries",
      name: "Slow Database Queries",
      description: "Database queries causing high latency",
      category: "performance",
      symptoms: ["slow query", "query timeout", "high latency", "database connection pool exhausted"],
      rootCauses: ["Missing indexes", "N+1 queries", "Large result sets", "Lock contention"],
      fixes: [
        "Add database indexes for frequently queried columns",
        "Optimize N+1 queries with eager loading",
        "Add pagination for large result sets",
        "Configure connection pool timeouts",
      ],
      occurrences: 0,
      successRate: 0.8,
      confidence: 0.75,
    },
    {
      id: "pat-deploy-failure",
      name: "Deployment Failure",
      description: "Application fails to start after deployment",
      category: "deployment",
      symptoms: ["CrashLoopBackOff", "readiness probe failed", "startup probe failed", "ImagePullBackOff"],
      rootCauses: ["Configuration error", "Missing environment variable", "Incompatible dependency", "Bad image"],
      fixes: [
        "Check deployment logs for startup errors",
        "Verify environment variables and config maps",
        "Rollback to previous working version",
        "Run pre-deployment validation checks",
      ],
      occurrences: 0,
      successRate: 0.85,
      confidence: 0.8,
    },
    {
      id: "pat-high-error-rate",
      name: "High Error Rate",
      description: "Sudden increase in HTTP 5xx errors",
      category: "reliability",
      symptoms: ["5xx errors", "error rate spike", "internal server error", "500 status"],
      rootCauses: ["Code bug in new deployment", "Downstream service failure", "Resource exhaustion", "Configuration change"],
      fixes: [
        "Check recent deployments and rollback if needed",
        "Investigate downstream service health",
        "Check resource utilization (CPU, memory, connections)",
        "Review error logs for root cause",
      ],
      occurrences: 0,
      successRate: 0.75,
      confidence: 0.7,
    },
    {
      id: "pat-kafka-lag",
      name: "Kafka Consumer Lag",
      description: "Consumer falling behind on message processing",
      category: "performance",
      symptoms: ["consumer lag", "message backlog", "slow consumer", "kafka offset behind"],
      rootCauses: ["Slow message processing", "Insufficient consumers", "Large message payloads", "Rebalancing"],
      fixes: [
        "Scale up consumer instances",
        "Optimize message processing logic",
        "Increase consumer batch size",
        "Check for poison messages blocking processing",
      ],
      occurrences: 0,
      successRate: 0.8,
      confidence: 0.75,
    },
    {
      id: "pat-cert-expiry",
      name: "Certificate Expiry",
      description: "TLS certificate expired or about to expire",
      category: "security",
      symptoms: ["certificate expired", "SSL error", "TLS handshake failed", "x509"],
      rootCauses: ["Certificate not renewed", "cert-manager misconfigured", "Manual certificate management"],
      fixes: [
        "Renew the certificate immediately",
        "Set up automated certificate renewal with cert-manager",
        "Add certificate expiry monitoring and alerting",
      ],
      occurrences: 0,
      successRate: 0.95,
      confidence: 0.9,
    },
    {
      id: "pat-disk-pressure",
      name: "Disk Pressure",
      description: "Node or container running low on disk space",
      category: "resource",
      symptoms: ["disk pressure", "no space left", "disk full", "eviction"],
      rootCauses: ["Log files not rotated", "Temp files not cleaned", "Large data volumes", "Container image cache"],
      fixes: [
        "Clean up old log files and enable rotation",
        "Add persistent volume claims with appropriate sizes",
        "Implement data retention policies",
        "Clean Docker image cache on nodes",
      ],
      occurrences: 0,
      successRate: 0.9,
      confidence: 0.85,
    },
  ];
}

async function matchPatterns(projectDir: string, incident: Incident): Promise<Pattern[]> {
  const patterns = await loadPatterns(projectDir);
  const matches: Pattern[] = [];

  const searchText = `${incident.title} ${incident.description} ${incident.sources.map((s) => s.summary).join(" ")}`.toLowerCase();

  for (const pattern of patterns) {
    const matchCount = pattern.symptoms.filter((s) => searchText.includes(s.toLowerCase())).length;
    if (matchCount > 0) {
      const matchStrength = matchCount / pattern.symptoms.length;
      if (matchStrength >= 0.25) { // At least 25% of symptoms match
        matches.push(pattern);
        // Update occurrence count
        pattern.occurrences++;
        pattern.lastSeen = incident.timestamp;
      }
    }
  }

  if (matches.length > 0) {
    await savePatterns(projectDir, patterns);
  }

  return matches;
}

export async function findSimilarIncidents(
  projectDir: string,
  incident: Incident,
  limit: number = 5
): Promise<Array<{ incident: Incident; similarity: number }>> {
  const allIncidents = await loadIncidents(projectDir);
  const results: Array<{ incident: Incident; similarity: number }> = [];

  const targetWords = new Set(
    `${incident.title} ${incident.description} ${incident.tags.join(" ")}`
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );

  for (const other of allIncidents) {
    if (other.id === incident.id) continue;

    const otherWords = new Set(
      `${other.title} ${other.description} ${other.tags.join(" ")}`
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3)
    );

    // Jaccard similarity
    const intersection = new Set([...targetWords].filter((w) => otherWords.has(w)));
    const union = new Set([...targetWords, ...otherWords]);
    const similarity = union.size > 0 ? intersection.size / union.size : 0;

    if (similarity > 0.1) {
      results.push({ incident: other, similarity });
    }
  }

  return results
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

// --- Fix Tracking ---

export async function recordFix(
  projectDir: string,
  incidentId: string,
  fix: Omit<FixRecord, "id" | "appliedAt">
): Promise<FixRecord | null> {
  const incidents = await loadIncidents(projectDir);
  const index = incidents.findIndex((i) => i.id === incidentId);
  if (index === -1) return null;

  const fixRecord: FixRecord = {
    ...fix,
    id: `fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    appliedAt: new Date().toISOString(),
  };

  incidents[index].fix = fixRecord;
  if (fix.outcome === "resolved") {
    incidents[index].status = "resolved";
    incidents[index].resolvedAt = new Date().toISOString();
  }

  await saveIncidents(projectDir, incidents);
  return fixRecord;
}

export async function updateFixOutcome(
  projectDir: string,
  incidentId: string,
  outcome: FixRecord["outcome"]
): Promise<boolean> {
  const incidents = await loadIncidents(projectDir);
  const index = incidents.findIndex((i) => i.id === incidentId);
  if (index === -1 || !incidents[index].fix) return false;

  incidents[index].fix!.outcome = outcome;
  if (outcome === "resolved") {
    incidents[index].fix!.resolvedAt = new Date().toISOString();
    incidents[index].status = "resolved";
    incidents[index].resolvedAt = new Date().toISOString();
  }

  await saveIncidents(projectDir, incidents);

  // Update pattern success rates based on fix outcomes
  await updatePatternStats(projectDir);

  return true;
}

async function updatePatternStats(projectDir: string): Promise<void> {
  const incidents = await loadIncidents(projectDir);
  const patterns = await loadPatterns(projectDir);

  for (const pattern of patterns) {
    // Find incidents that match this pattern
    const matchingIncidents = incidents.filter((inc) => {
      const text = `${inc.title} ${inc.description}`.toLowerCase();
      return pattern.symptoms.some((s) => text.includes(s.toLowerCase()));
    });

    const withFixes = matchingIncidents.filter((i) => i.fix);
    const resolved = withFixes.filter((i) => i.fix?.outcome === "resolved");

    if (withFixes.length > 0) {
      pattern.successRate = resolved.length / withFixes.length;
    }
    pattern.occurrences = matchingIncidents.length;
  }

  await savePatterns(projectDir, patterns);
}

// --- Statistics ---

export async function getKnowledgeBaseStats(projectDir: string): Promise<KnowledgeBaseStats> {
  const incidents = await loadIncidents(projectDir);
  const patterns = await loadPatterns(projectDir);

  const byType: Record<string, number> = {};
  let openCount = 0;
  let resolvedCount = 0;

  for (const inc of incidents) {
    byType[inc.type] = (byType[inc.type] || 0) + 1;
    if (inc.status === "open" || inc.status === "investigating") openCount++;
    if (inc.status === "resolved") resolvedCount++;
  }

  const byCategory: Record<string, number> = {};
  for (const pat of patterns) {
    byCategory[pat.category] = (byCategory[pat.category] || 0) + 1;
  }

  const fixes = incidents.filter((i) => i.fix);
  const resolvedFixes = fixes.filter((i) => i.fix?.outcome === "resolved");

  return {
    incidents: {
      total: incidents.length,
      open: openCount,
      resolved: resolvedCount,
      byType,
    },
    patterns: {
      total: patterns.length,
      byCategory,
    },
    fixes: {
      total: fixes.length,
      resolved: resolvedFixes.length,
      successRate: fixes.length > 0 ? resolvedFixes.length / fixes.length : 0,
    },
  };
}

// --- Initialize ---

export async function initializeKnowledgeBase(projectDir: string): Promise<void> {
  await ensureKbDir(projectDir);
  const patterns = await loadPatterns(projectDir);
  if (patterns.length === 0) {
    await savePatterns(projectDir, getBuiltinPatterns());
  }
}
