import { promises as fs } from "fs";
import path from "path";
import {
  DeploymentRecordSchema,
  type DeploymentRecord,
} from "@blissful-infra/shared";

export type { DeploymentRecord } from "@blissful-infra/shared";

const DATA_DIR = ".blissful-infra";
const DEPLOYMENTS_FILE = "deployments.jsonl";

function getDataDir(projectDir: string): string {
  return path.join(projectDir, DATA_DIR);
}

export function getDeploymentFilePath(projectDir: string): string {
  return path.join(getDataDir(projectDir), DEPLOYMENTS_FILE);
}

async function ensureDataDir(projectDir: string): Promise<void> {
  const dataDir = getDataDir(projectDir);
  await fs.mkdir(dataDir, { recursive: true });
}

export async function saveDeployment(
  projectDir: string,
  record: DeploymentRecord
): Promise<void> {
  await ensureDataDir(projectDir);
  const filePath = getDeploymentFilePath(projectDir);
  const line = JSON.stringify(record) + "\n";
  await fs.appendFile(filePath, line, "utf8");
}

export async function updateDeployment(
  projectDir: string,
  id: string,
  updates: Partial<DeploymentRecord>
): Promise<boolean> {
  const filePath = getDeploymentFilePath(projectDir);

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return false;
  }

  const lines = content.split("\n").filter((l) => l.trim());
  let found = false;

  const updatedLines = lines.map((line) => {
    try {
      const parsed = DeploymentRecordSchema.safeParse(JSON.parse(line));
      if (parsed.success && parsed.data.id === id) {
        found = true;
        return JSON.stringify({ ...parsed.data, ...updates });
      }
    } catch {
      // Skip malformed lines unchanged
    }
    return line;
  });

  if (!found) {
    return false;
  }

  await fs.writeFile(filePath, updatedLines.join("\n") + "\n", "utf8");
  return true;
}

export async function loadDeployments(
  projectDir: string,
  limit = 50
): Promise<DeploymentRecord[]> {
  const filePath = getDeploymentFilePath(projectDir);

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }

  const records: DeploymentRecord[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    const parsed = DeploymentRecordSchema.safeParse(JSON.parse(line));
    if (parsed.success) {
      records.push(parsed.data);
    }
  }

  return records.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}
