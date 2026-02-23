import fs from "node:fs/promises";
import path from "node:path";

export interface RegistryConfig {
  type: "local" | "ecr" | "gcr" | "acr";
  url: string;
  region?: string;
}

export interface KubernetesConfig {
  context?: string;
  namespace?: string;
}

export interface ArgoCDConfig {
  server?: string;
  project?: string;
}

export interface PipelineConfig {
  parallelTests?: boolean;
  securityScan?: boolean;
  buildCache?: boolean;
}

export interface CanaryConfig {
  enabled?: boolean;
  steps?: Array<{ weight: number; pause: string }>;
  analysis?: {
    interval?: string;
    failureLimit?: number;
    metrics?: Array<{
      name: string;
      threshold: string;
      query?: string;
    }>;
  };
}

export interface PluginInstance {
  type: string;      // template name (e.g. "ai-pipeline")
  instance: string;  // unique instance name (e.g. "classifier")
}

export interface PluginConfig {
  mode?: string;
  port?: number;
  events_topic?: string;
  predictions_topic?: string;
}

export interface ProjectConfig {
  name: string;
  type: string;
  backend?: string;
  frontend?: string;
  database: string;
  deployTarget: string;
  // Phase 2 additions
  registry?: RegistryConfig;
  kubernetes?: KubernetesConfig;
  argocd?: ArgoCDConfig;
  pipeline?: PipelineConfig;
  // Phase 4 additions
  canary?: CanaryConfig;
  // Phase 3.6 monitoring
  monitoring?: "default" | "prometheus";
  // Plugins
  plugins?: PluginInstance[];
  pluginConfigs?: Record<string, PluginConfig>;
}

/**
 * Parse plugin specs like "ai-pipeline", "ai-pipeline:classifier" into PluginInstance objects.
 */
export function parsePluginSpecs(specs: string[]): PluginInstance[] {
  return specs.map(spec => {
    const colonIndex = spec.indexOf(":");
    if (colonIndex === -1) {
      return { type: spec, instance: spec };
    }
    return {
      type: spec.substring(0, colonIndex),
      instance: spec.substring(colonIndex + 1),
    };
  });
}

/**
 * Serialize plugin instances back to spec strings for YAML storage.
 */
export function serializePluginSpecs(plugins: PluginInstance[]): string {
  return plugins
    .map(p => p.type === p.instance ? p.type : `${p.type}:${p.instance}`)
    .join(",");
}

export async function loadConfig(projectDir?: string): Promise<ProjectConfig | null> {
  const configPath = path.join(projectDir || process.cwd(), "blissful-infra.yaml");

  try {
    const content = await fs.readFile(configPath, "utf-8");
    return parseYaml(content);
  } catch {
    return null;
  }
}

/**
 * Find a project directory by name, or use cwd if it contains blissful-infra.yaml.
 */
export async function findProjectDir(name?: string): Promise<string | null> {
  if (name) {
    const projectDir = path.join(process.cwd(), name);
    try {
      await fs.access(path.join(projectDir, "blissful-infra.yaml"));
      return projectDir;
    } catch {
      return null;
    }
  }

  try {
    await fs.access(path.join(process.cwd(), "blissful-infra.yaml"));
    return process.cwd();
  } catch {
    return null;
  }
}

function parseYaml(content: string): ProjectConfig {
  // Simple YAML parser for our config format
  const config: Record<string, string> = {};

  for (const line of content.split("\n")) {
    // Skip comments and empty lines
    if (line.trim().startsWith("#") || !line.trim()) {
      continue;
    }

    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      config[key] = value.trim();
    }
  }

  return {
    name: config.name || "unnamed",
    type: config.type || "backend",
    backend: config.backend,
    frontend: config.frontend,
    database: config.database || "none",
    deployTarget: config.deploy_target || "local-only",
    monitoring: (config.monitoring === "default" ? "default" : "prometheus") as "default" | "prometheus",
    plugins: config.plugins ? parsePluginSpecs(config.plugins.split(",").map(p => p.trim()).filter(Boolean)) : undefined,
    pluginConfigs: parsePluginConfigs(content),
  };
}

function parsePluginConfigs(content: string): Record<string, PluginConfig> | undefined {
  const configs: Record<string, PluginConfig> = {};
  const lines = content.split("\n");
  let inPluginConfig = false;
  let currentInstance: string | null = null;

  for (const line of lines) {
    // Detect start of plugin_config block
    if (/^plugin_config:\s*$/.test(line)) {
      inPluginConfig = true;
      continue;
    }

    if (!inPluginConfig) continue;

    // Non-indented line means we've left the plugin_config block
    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t")) {
      break;
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Instance name line (2-space indent): "  classifier:"
    const instanceMatch = line.match(/^ {2}(\w[\w-]*):\s*$/);
    if (instanceMatch) {
      currentInstance = instanceMatch[1];
      configs[currentInstance] = {};
      continue;
    }

    // Config value line (4-space indent): "    mode: streaming"
    const valueMatch = line.match(/^ {4}(\w[\w_]*):\s*(.+)$/);
    if (valueMatch && currentInstance && configs[currentInstance]) {
      const [, key, value] = valueMatch;
      const trimVal = value.trim();
      if (key === "port") {
        configs[currentInstance].port = parseInt(trimVal, 10);
      } else if (key === "mode") {
        configs[currentInstance].mode = trimVal;
      } else if (key === "events_topic") {
        configs[currentInstance].events_topic = trimVal;
      } else if (key === "predictions_topic") {
        configs[currentInstance].predictions_topic = trimVal;
      }
    }
  }

  return Object.keys(configs).length > 0 ? configs : undefined;
}
