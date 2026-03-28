import { z } from "zod";

/** Shape used in API responses (includes networkRx/Tx from docker stats) */
export const ContainerMetricsSchema = z.object({
  name: z.string(),
  cpuPercent: z.number(),
  memoryUsage: z.number(),
  memoryLimit: z.number(),
  memoryPercent: z.number(),
  networkRx: z.number(),
  networkTx: z.number(),
});

/** Shape stored in JSONL (subset — no networkRx/Tx) */
export const ContainerMetricsDataSchema = z.object({
  name: z.string(),
  cpuPercent: z.number(),
  memoryPercent: z.number(),
  memoryUsage: z.number(),
  memoryLimit: z.number(),
  networkRx: z.number(),
  networkTx: z.number(),
});

export const HttpMetricsSchema = z.object({
  totalRequests: z.number(),
  requestsPerSecond: z.number(),
  avgResponseTime: z.number(),
  p50Latency: z.number().optional(),
  p95Latency: z.number().optional(),
  p99Latency: z.number().optional(),
  errorCount: z.number().optional(),
  errorRate: z.number().optional(),
  status2xx: z.number().optional(),
  status4xx: z.number().optional(),
  status5xx: z.number().optional(),
});

/** Stored JSONL record (fewer fields than full API HttpMetrics) */
export const HttpMetricsDataSchema = z.object({
  totalRequests: z.number(),
  avgResponseTime: z.number(),
  p50Latency: z.number().optional(),
  p95Latency: z.number().optional(),
  p99Latency: z.number().optional(),
  errorRate: z.number().optional(),
  status2xx: z.number().optional(),
  status4xx: z.number().optional(),
  status5xx: z.number().optional(),
});

export const StoredMetricsSchema = z.object({
  timestamp: z.number(),
  projectName: z.string(),
  containers: z.array(ContainerMetricsDataSchema),
  http: HttpMetricsDataSchema.optional(),
});

export const ProjectMetricsSchema = z.object({
  containers: z.array(ContainerMetricsSchema),
  httpMetrics: HttpMetricsSchema.optional(),
  timestamp: z.number(),
});

export type ContainerMetrics = z.infer<typeof ContainerMetricsSchema>;
export type ContainerMetricsData = z.infer<typeof ContainerMetricsDataSchema>;
export type HttpMetrics = z.infer<typeof HttpMetricsSchema>;
export type HttpMetricsData = z.infer<typeof HttpMetricsDataSchema>;
export type StoredMetrics = z.infer<typeof StoredMetricsSchema>;
export type ProjectMetrics = z.infer<typeof ProjectMetricsSchema>;
