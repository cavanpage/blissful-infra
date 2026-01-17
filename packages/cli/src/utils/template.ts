import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface TemplateVariables {
  projectName: string;
  database: string;
  deployTarget: string;
}

export async function copyTemplate(
  templateName: string,
  destDir: string,
  variables: TemplateVariables
): Promise<void> {
  const templateDir = path.join(__dirname, "..", "..", "templates", templateName);

  // Check if template exists
  try {
    await fs.access(templateDir);
  } catch {
    throw new Error(`Template '${templateName}' not found at ${templateDir}`);
  }

  await copyDir(templateDir, destDir, variables);
}

async function copyDir(
  srcDir: string,
  destDir: string,
  variables: TemplateVariables
): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });

  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, variables);
    } else {
      await copyFile(srcPath, destPath, variables);
    }
  }
}

async function copyFile(
  srcPath: string,
  destPath: string,
  variables: TemplateVariables
): Promise<void> {
  const content = await fs.readFile(srcPath, "utf-8");
  const processed = replaceVariables(content, variables);
  await fs.writeFile(destPath, processed);
}

function replaceVariables(content: string, variables: TemplateVariables): string {
  return content
    .replace(/\{\{PROJECT_NAME\}\}/g, variables.projectName)
    .replace(/\{\{DATABASE\}\}/g, variables.database)
    .replace(/\{\{DEPLOY_TARGET\}\}/g, variables.deployTarget);
}

export function getAvailableTemplates(): string[] {
  return ["spring-boot"];
}
