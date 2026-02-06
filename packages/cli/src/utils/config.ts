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
  };
}
