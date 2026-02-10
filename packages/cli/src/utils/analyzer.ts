import type { Incident, Pattern } from "./knowledge-base.js";
import { loadPatterns, findSimilarIncidents, loadIncidents } from "./knowledge-base.js";
import type { TimelineEvent } from "./collectors.js";
import { collectFullContext } from "./collectors.js";

/**
 * Root cause analysis engine.
 * Correlates data from multiple sources to identify likely root causes.
 */

export interface AnalysisResult {
  timestamp: string;
  project: string;
  finding: string;
  confidence: number; // 0-100
  rootCause: string;
  timeline: TimelineEvent[];
  correlations: Correlation[];
  matchedPatterns: PatternMatch[];
  similarIncidents: Array<{ incident: Incident; similarity: number }>;
  suggestedFixes: SuggestedFix[];
}

export interface Correlation {
  sourceA: string;
  sourceB: string;
  description: string;
  confidence: number;
}

export interface PatternMatch {
  pattern: Pattern;
  matchStrength: number; // 0-1
  matchedSymptoms: string[];
}

export interface SuggestedFix {
  description: string;
  type: "code-change" | "config-change" | "infrastructure" | "rollback" | "manual";
  confidence: number;
  source: string; // Which pattern or incident suggested this
  autoFixAvailable: boolean;
}

/**
 * Analyze current system state to find issues
 */
export async function analyzeSystem(
  projectDir: string,
  projectName: string,
  options: { includeK8s?: boolean; namespace?: string; incidentId?: string } = {}
): Promise<AnalysisResult> {
  // Collect all available context
  const { sources, timeline, context } = await collectFullContext(
    projectDir,
    projectName,
    options
  );

  // If analyzing a specific incident, focus on that
  if (options.incidentId) {
    const incidents = await loadIncidents(projectDir);
    const incident = incidents.find((i) => i.id === options.incidentId);
    if (incident) {
      return analyzeIncident(projectDir, projectName, incident, timeline);
    }
  }

  // Detect issues from collected context
  const issues = detectIssues(sources, context);

  if (issues.length === 0) {
    return {
      timestamp: new Date().toISOString(),
      project: projectName,
      finding: "No issues detected",
      confidence: 90,
      rootCause: "System appears healthy based on available data",
      timeline,
      correlations: [],
      matchedPatterns: [],
      similarIncidents: [],
      suggestedFixes: [],
    };
  }

  // Take the most severe issue
  const primaryIssue = issues[0];

  // Match against known patterns
  const patterns = await loadPatterns(projectDir);
  const matchedPatterns = matchPatternsToIssue(patterns, primaryIssue);

  // Find correlations
  const correlations = findCorrelations(sources, context, timeline);

  // Find similar past incidents
  const tempIncident: Incident = {
    id: "temp",
    timestamp: new Date().toISOString(),
    project: projectName,
    type: primaryIssue.type as Incident["type"],
    severity: primaryIssue.severity as Incident["severity"],
    title: primaryIssue.finding,
    description: primaryIssue.details,
    status: "investigating",
    sources: sources.map((s) => ({ type: s.type, summary: s.summary })),
    tags: primaryIssue.tags,
    createdAt: new Date().toISOString(),
  };

  const similarIncidents = await findSimilarIncidents(projectDir, tempIncident);

  // Generate fix suggestions
  const suggestedFixes = generateFixSuggestions(matchedPatterns, similarIncidents, primaryIssue);

  // Calculate overall confidence
  const confidence = calculateConfidence(matchedPatterns, correlations, similarIncidents);

  // Determine root cause
  const rootCause = determineRootCause(primaryIssue, matchedPatterns, correlations);

  return {
    timestamp: new Date().toISOString(),
    project: projectName,
    finding: primaryIssue.finding,
    confidence,
    rootCause,
    timeline,
    correlations,
    matchedPatterns,
    similarIncidents,
    suggestedFixes,
  };
}

async function analyzeIncident(
  projectDir: string,
  projectName: string,
  incident: Incident,
  timeline: TimelineEvent[]
): Promise<AnalysisResult> {
  const patterns = await loadPatterns(projectDir);
  const searchText = `${incident.title} ${incident.description} ${incident.sources.map((s) => s.summary).join(" ")}`;

  const matchedPatterns: PatternMatch[] = [];
  for (const pattern of patterns) {
    const matched = pattern.symptoms.filter((s) => searchText.toLowerCase().includes(s.toLowerCase()));
    if (matched.length > 0) {
      matchedPatterns.push({
        pattern,
        matchStrength: matched.length / pattern.symptoms.length,
        matchedSymptoms: matched,
      });
    }
  }
  matchedPatterns.sort((a, b) => b.matchStrength - a.matchStrength);

  const similarIncidents = await findSimilarIncidents(projectDir, incident);
  const suggestedFixes = generateFixSuggestions(matchedPatterns, similarIncidents, {
    finding: incident.title,
    details: incident.description,
    type: incident.type,
    severity: incident.severity,
    tags: incident.tags,
  });

  return {
    timestamp: new Date().toISOString(),
    project: projectName,
    finding: incident.title,
    confidence: calculateConfidence(matchedPatterns, [], similarIncidents),
    rootCause: incident.rootCause || determineRootCause(
      { finding: incident.title, details: incident.description, type: incident.type, severity: incident.severity, tags: incident.tags },
      matchedPatterns,
      []
    ),
    timeline,
    correlations: [],
    matchedPatterns,
    similarIncidents,
    suggestedFixes,
  };
}

interface DetectedIssue {
  finding: string;
  details: string;
  type: string;
  severity: string;
  tags: string[];
}

function detectIssues(
  sources: Array<{ type: string; summary: string; data?: Record<string, unknown> }>,
  context: { logs: Array<{ service: string; message: string }>; commits: Array<{ sha: string; message: string }> }
): DetectedIssue[] {
  const issues: DetectedIssue[] = [];

  // Check for error patterns in logs
  const errorLogs = context.logs.filter((l) =>
    /error|exception|fatal|panic|fail/i.test(l.message)
  );

  if (errorLogs.length > 10) {
    const services = [...new Set(errorLogs.map((l) => l.service))];
    issues.push({
      finding: `High error rate detected in logs (${errorLogs.length} errors)`,
      details: `Errors found in services: ${services.join(", ")}. Sample: ${errorLogs[0]?.message.slice(0, 200)}`,
      type: "error-spike",
      severity: errorLogs.length > 50 ? "critical" : "high",
      tags: ["errors", ...services],
    });
  }

  // Check for OOM patterns
  const oomLogs = context.logs.filter((l) =>
    /oomkilled|out of memory|heap space|memory limit/i.test(l.message)
  );
  if (oomLogs.length > 0) {
    issues.push({
      finding: "Memory exhaustion detected",
      details: `OOM-related messages found: ${oomLogs[0]?.message.slice(0, 200)}`,
      type: "resource-exhaustion",
      severity: "critical",
      tags: ["oom", "memory"],
    });
  }

  // Check for connection errors
  const connErrors = context.logs.filter((l) =>
    /connection refused|econnrefused|connection reset|timeout/i.test(l.message)
  );
  if (connErrors.length > 5) {
    issues.push({
      finding: "Connection failures detected",
      details: `${connErrors.length} connection errors found. Sample: ${connErrors[0]?.message.slice(0, 200)}`,
      type: "dependency-failure",
      severity: "high",
      tags: ["connection", "dependency"],
    });
  }

  // Check container metrics for resource issues
  for (const source of sources) {
    if (source.type === "metrics" && source.data?.containers) {
      const containers = source.data.containers as Array<{ name: string; cpu: string; memPct: string }>;
      for (const c of containers) {
        const cpuPct = parseFloat(c.cpu?.replace("%", "") || "0");
        const memPct = parseFloat(c.memPct?.replace("%", "") || "0");

        if (cpuPct > 90) {
          issues.push({
            finding: `High CPU usage on ${c.name}: ${c.cpu}`,
            details: `Container ${c.name} is using ${c.cpu} CPU`,
            type: "resource-exhaustion",
            severity: cpuPct > 95 ? "critical" : "high",
            tags: ["cpu", "resource"],
          });
        }
        if (memPct > 85) {
          issues.push({
            finding: `High memory usage on ${c.name}: ${c.memPct}`,
            details: `Container ${c.name} is using ${c.memPct} memory`,
            type: "resource-exhaustion",
            severity: memPct > 95 ? "critical" : "high",
            tags: ["memory", "resource"],
          });
        }
      }
    }
  }

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => (severityOrder[a.severity as keyof typeof severityOrder] || 3) - (severityOrder[b.severity as keyof typeof severityOrder] || 3));

  return issues;
}

function matchPatternsToIssue(patterns: Pattern[], issue: DetectedIssue): PatternMatch[] {
  const matches: PatternMatch[] = [];
  const searchText = `${issue.finding} ${issue.details} ${issue.tags.join(" ")}`.toLowerCase();

  for (const pattern of patterns) {
    const matched = pattern.symptoms.filter((s) => searchText.includes(s.toLowerCase()));
    if (matched.length > 0) {
      matches.push({
        pattern,
        matchStrength: matched.length / pattern.symptoms.length,
        matchedSymptoms: matched,
      });
    }
  }

  return matches.sort((a, b) => b.matchStrength - a.matchStrength);
}

function findCorrelations(
  _sources: Array<{ type: string; summary: string; data?: Record<string, unknown> }>,
  _context: { logs: Array<{ service: string; message: string }>; commits: Array<{ sha: string; message: string }> },
  timeline: TimelineEvent[]
): Correlation[] {
  const correlations: Correlation[] = [];

  // Check if errors correlate with recent deployments
  const errorEvents = timeline.filter((e) => e.severity === "error");
  const commitEvents = timeline.filter((e) => e.source === "git");

  if (errorEvents.length > 0 && commitEvents.length > 0) {
    // Find commits close in time to errors
    for (const error of errorEvents.slice(0, 5)) {
      for (const commit of commitEvents) {
        const timeDiff = Math.abs(
          new Date(error.timestamp).getTime() - new Date(commit.timestamp).getTime()
        );
        if (timeDiff < 3600000) { // Within 1 hour
          correlations.push({
            sourceA: "logs",
            sourceB: "git",
            description: `Error "${error.event.slice(0, 100)}" occurred within 1h of commit "${commit.details}"`,
            confidence: Math.max(0.3, 1 - timeDiff / 3600000),
          });
        }
      }
    }
  }

  return correlations.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

function generateFixSuggestions(
  matchedPatterns: PatternMatch[],
  similarIncidents: Array<{ incident: Incident; similarity: number }>,
  _issue: DetectedIssue
): SuggestedFix[] {
  const fixes: SuggestedFix[] = [];

  // Suggestions from matched patterns
  for (const match of matchedPatterns.slice(0, 3)) {
    for (const fix of match.pattern.fixes) {
      fixes.push({
        description: fix,
        type: "manual",
        confidence: match.matchStrength * match.pattern.successRate * 100,
        source: `Pattern: ${match.pattern.name}`,
        autoFixAvailable: false,
      });
    }
  }

  // Suggestions from similar resolved incidents
  for (const { incident, similarity } of similarIncidents) {
    if (incident.resolution) {
      fixes.push({
        description: incident.resolution,
        type: incident.fix?.type || "manual",
        confidence: similarity * 100,
        source: `Similar incident: ${incident.title}`,
        autoFixAvailable: !!incident.fix?.diff,
      });
    }
  }

  // Deduplicate and sort by confidence
  const seen = new Set<string>();
  return fixes.filter((f) => {
    const key = f.description.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.confidence - a.confidence).slice(0, 10);
}

function calculateConfidence(
  matchedPatterns: PatternMatch[],
  correlations: Correlation[],
  similarIncidents: Array<{ incident: Incident; similarity: number }>
): number {
  let confidence = 20; // Base confidence

  // Pattern matches boost confidence
  if (matchedPatterns.length > 0) {
    confidence += matchedPatterns[0].matchStrength * 30;
  }

  // Correlations boost confidence
  if (correlations.length > 0) {
    confidence += Math.min(correlations[0].confidence * 25, 25);
  }

  // Similar incidents boost confidence
  if (similarIncidents.length > 0) {
    confidence += similarIncidents[0].similarity * 20;
  }

  // Multiple sources agreeing boosts confidence
  if (matchedPatterns.length > 0 && correlations.length > 0) {
    confidence += 5;
  }

  return Math.min(Math.round(confidence), 95);
}

function determineRootCause(
  issue: DetectedIssue,
  matchedPatterns: PatternMatch[],
  correlations: Correlation[]
): string {
  const causes: string[] = [];

  // From patterns
  if (matchedPatterns.length > 0) {
    const topPattern = matchedPatterns[0];
    causes.push(...topPattern.pattern.rootCauses.slice(0, 2));
  }

  // From correlations
  for (const corr of correlations.slice(0, 2)) {
    if (corr.sourceA === "logs" && corr.sourceB === "git") {
      causes.push(`Recent code change may be the trigger: ${corr.description}`);
    }
  }

  if (causes.length === 0) {
    causes.push(`Detected: ${issue.finding}. Further investigation needed.`);
  }

  return causes[0];
}
