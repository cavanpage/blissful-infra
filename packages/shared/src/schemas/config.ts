import { z } from "zod";

export const RegistryConfigSchema = z.object({
  type: z.enum(["local", "ecr", "gcr", "acr"]),
  url: z.string(),
  region: z.string().optional(),
});

export const KubernetesConfigSchema = z.object({
  context: z.string().optional(),
  namespace: z.string().optional(),
});

export const ArgoCDConfigSchema = z.object({
  server: z.string().optional(),
  project: z.string().optional(),
});

export const PipelineConfigSchema = z.object({
  parallelTests: z.boolean().optional(),
  securityScan: z.boolean().optional(),
  buildCache: z.boolean().optional(),
});

const CanaryStepSchema = z.object({
  weight: z.number(),
  pause: z.string(),
});

const CanaryMetricSchema = z.object({
  name: z.string(),
  threshold: z.string(),
  query: z.string().optional(),
});

export const CanaryConfigSchema = z.object({
  enabled: z.boolean().optional(),
  steps: z.array(CanaryStepSchema).optional(),
  analysis: z.object({
    interval: z.string().optional(),
    failureLimit: z.number().optional(),
    metrics: z.array(CanaryMetricSchema).optional(),
  }).optional(),
});

export const PluginInstanceSchema = z.object({
  type: z.string(),
  instance: z.string(),
});

export const PluginConfigSchema = z.object({
  mode: z.string().optional(),
  port: z.number().optional(),
  events_topic: z.string().optional(),
  predictions_topic: z.string().optional(),
});

export const ProjectConfigSchema = z.object({
  name: z.string(),
  type: z.string(),
  backend: z.string().optional(),
  frontend: z.string().optional(),
  database: z.string(),
  deployTarget: z.string(),
  registry: RegistryConfigSchema.optional(),
  kubernetes: KubernetesConfigSchema.optional(),
  argocd: ArgoCDConfigSchema.optional(),
  pipeline: PipelineConfigSchema.optional(),
  canary: CanaryConfigSchema.optional(),
  monitoring: z.enum(["default", "prometheus"]).optional(),
  plugins: z.array(PluginInstanceSchema).optional(),
  pluginConfigs: z.record(z.string(), PluginConfigSchema).optional(),
});

export type RegistryConfig = z.infer<typeof RegistryConfigSchema>;
export type KubernetesConfig = z.infer<typeof KubernetesConfigSchema>;
export type ArgoCDConfig = z.infer<typeof ArgoCDConfigSchema>;
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;
export type CanaryConfig = z.infer<typeof CanaryConfigSchema>;
export type PluginInstance = z.infer<typeof PluginInstanceSchema>;
export type PluginConfig = z.infer<typeof PluginConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
