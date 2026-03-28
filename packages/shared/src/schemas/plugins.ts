import { z } from "zod";

export const PluginCategorySchema = z.enum([
  "AI/ML",
  "Data",
  "Orchestration",
  "Observability",
  "Infrastructure",
]);

export const PluginUiSchema = z.object({
  path: z.string(),
  label: z.string().optional(),
});

export const PluginDefSchema = z.object({
  displayName: z.string(),
  description: z.string(),
  category: PluginCategorySchema,
  defaultPort: z.number(),
  healthPath: z.string(),
  color: z.string(),
  ui: PluginUiSchema.optional(),
});

export const DataPlatformDefSchema = z.object({
  displayName: z.string(),
  description: z.string(),
  defaultPort: z.number(),
  color: z.string(),
  ui: PluginUiSchema.optional(),
});

/** Plugin status as returned by GET /api/projects/:name/plugins */
export const PluginStatusSchema = z.object({
  instance: z.string(),
  type: z.string(),
  status: z.enum(["running", "stopped", "unhealthy", "unknown"]),
  port: z.number().optional(),
  url: z.string().optional(),
  health: z.enum(["healthy", "unhealthy", "unknown"]).optional(),
  def: PluginDefSchema.optional(),
});

export type PluginCategory = z.infer<typeof PluginCategorySchema>;
export type PluginUi = z.infer<typeof PluginUiSchema>;
export type PluginDef = z.infer<typeof PluginDefSchema>;
export type DataPlatformDef = z.infer<typeof DataPlatformDefSchema>;
export type PluginStatus = z.infer<typeof PluginStatusSchema>;
