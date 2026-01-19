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

// Binary file extensions that should not be processed for template variables
const BINARY_EXTENSIONS = new Set([
  '.jar', '.class', '.war', '.ear',
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.tar', '.gz', '.bz2', '.7z',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
]);

function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

async function copyFile(
  srcPath: string,
  destPath: string,
  variables: TemplateVariables
): Promise<void> {
  if (isBinaryFile(srcPath)) {
    // Copy binary files directly without processing
    await fs.copyFile(srcPath, destPath);
  } else {
    // Process text files for template variables
    const content = await fs.readFile(srcPath, "utf-8");
    const processed = replaceVariables(content, variables);
    await fs.writeFile(destPath, processed);
  }
}

function replaceVariables(content: string, variables: TemplateVariables): string {
  return content
    .replace(/\{\{PROJECT_NAME\}\}/g, variables.projectName)
    .replace(/\{\{DATABASE\}\}/g, variables.database)
    .replace(/\{\{DEPLOY_TARGET\}\}/g, variables.deployTarget);
}

export function getAvailableTemplates(): string[] {
  return ["spring-boot", "react-vite"];
}
