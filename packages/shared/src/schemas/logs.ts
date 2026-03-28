import { z } from "zod";

export const LogLevelSchema = z.enum(["info", "warn", "error", "debug"]);

export const StoredLogEntrySchema = z.object({
  timestamp: z.string(),
  service: z.string(),
  message: z.string(),
  level: LogLevelSchema.optional(),
});

export const LogRetentionConfigSchema = z.object({
  maxFileSizeMb: z.number(),
  maxRetentionDays: z.number(),
  maxFiles: z.number(),
  persistEnabled: z.boolean(),
});

export const LogStorageStatsSchema = z.object({
  totalSize: z.number(),
  fileCount: z.number(),
});

export type LogLevel = z.infer<typeof LogLevelSchema>;
export type StoredLogEntry = z.infer<typeof StoredLogEntrySchema>;
export type LogRetentionConfig = z.infer<typeof LogRetentionConfigSchema>;
export type LogStorageStats = z.infer<typeof LogStorageStatsSchema>;
