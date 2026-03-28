import { z } from "zod";

export const AlertMetricSchema = z.enum([
  "cpu",
  "memory",
  "errorRate",
  "p95Latency",
  "p99Latency",
]);

export const AlertOperatorSchema = z.enum([">", "<", ">=", "<="]);

export const AlertSeveritySchema = z.enum(["warning", "critical"]);

export const AlertThresholdSchema = z.object({
  id: z.string(),
  name: z.string(),
  metric: AlertMetricSchema,
  operator: AlertOperatorSchema,
  value: z.number(),
  container: z.string().optional(),
  enabled: z.boolean(),
  severity: AlertSeveritySchema,
});

export const TriggeredAlertSchema = z.object({
  id: z.string(),
  thresholdId: z.string(),
  name: z.string(),
  metric: z.string(),
  value: z.number(),
  threshold: z.number(),
  severity: AlertSeveritySchema,
  triggeredAt: z.number(),
  resolvedAt: z.number().optional(),
  container: z.string().optional(),
});

export const AlertsConfigSchema = z.object({
  thresholds: z.array(AlertThresholdSchema),
  notifyOnConsole: z.boolean(),
  cooldownMs: z.number(),
});

export const AlertsStateSchema = z.object({
  activeAlerts: z.array(TriggeredAlertSchema),
  alertHistory: z.array(TriggeredAlertSchema),
});

export type AlertMetric = z.infer<typeof AlertMetricSchema>;
export type AlertOperator = z.infer<typeof AlertOperatorSchema>;
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;
export type AlertThreshold = z.infer<typeof AlertThresholdSchema>;
export type TriggeredAlert = z.infer<typeof TriggeredAlertSchema>;
export type AlertsConfig = z.infer<typeof AlertsConfigSchema>;
export type AlertsState = z.infer<typeof AlertsStateSchema>;
