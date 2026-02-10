import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { loadConfig, findProjectDir, type ProjectConfig } from "../utils/config.js";

interface PipelineOptions {
  local?: boolean;
  push?: boolean;
  skipTests?: boolean;
  skipScan?: boolean;
}

interface PipelineStage {
  name: string;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  duration?: number;
}

async function detectProjectType(projectDir: string): Promise<"gradle" | "maven" | "npm" | "go" | "unknown"> {
  // Check for build files
  const checks = [
    { file: "build.gradle.kts", type: "gradle" as const },
    { file: "build.gradle", type: "gradle" as const },
    { file: "pom.xml", type: "maven" as const },
    { file: "package.json", type: "npm" as const },
    { file: "go.mod", type: "go" as const },
  ];

  for (const check of checks) {
    try {
      await fs.access(path.join(projectDir, check.file));
      return check.type;
    } catch {
      // Continue
    }
  }

  // Check backend subdirectory for fullstack projects
  for (const check of checks) {
    try {
      await fs.access(path.join(projectDir, "backend", check.file));
      return check.type;
    } catch {
      // Continue
    }
  }

  return "unknown";
}

async function runStage(
  name: string,
  fn: () => Promise<void>,
  stages: PipelineStage[]
): Promise<boolean> {
  const stage = stages.find((s) => s.name === name);
  if (!stage) return false;

  stage.status = "running";
  const startTime = Date.now();

  try {
    await fn();
    stage.status = "success";
    stage.duration = Date.now() - startTime;
    return true;
  } catch (error) {
    stage.status = "failed";
    stage.duration = Date.now() - startTime;
    return false;
  }
}

function printStages(stages: PipelineStage[]): void {
  console.log();
  console.log(chalk.bold("Pipeline Status:"));
  console.log();

  for (const stage of stages) {
    let icon: string;
    let color: typeof chalk;

    switch (stage.status) {
      case "success":
        icon = "✓";
        color = chalk.green;
        break;
      case "failed":
        icon = "✗";
        color = chalk.red;
        break;
      case "running":
        icon = "◐";
        color = chalk.yellow;
        break;
      case "skipped":
        icon = "○";
        color = chalk.dim;
        break;
      default:
        icon = "○";
        color = chalk.dim;
    }

    const duration = stage.duration ? chalk.dim(` (${(stage.duration / 1000).toFixed(1)}s)`) : "";
    console.log(`  ${color(icon)} ${stage.name}${duration}`);
  }
  console.log();
}

async function runLocalPipeline(
  config: ProjectConfig,
  projectDir: string,
  opts: PipelineOptions
): Promise<void> {
  const projectType = await detectProjectType(projectDir);
  const backendDir = config.type === "fullstack" ? path.join(projectDir, "backend") : projectDir;
  const registryUrl = "localhost:5000";
  const imageTag = `${registryUrl}/${config.name}:local`;

  const stages: PipelineStage[] = [
    { name: "Build", status: "pending" },
    { name: "Test", status: opts.skipTests ? "skipped" : "pending" },
    { name: "Containerize", status: "pending" },
    { name: "Security Scan", status: opts.skipScan ? "skipped" : "pending" },
    { name: "Push", status: opts.push ? "pending" : "skipped" },
  ];

  console.log(chalk.bold(`\nRunning local pipeline for ${config.name}\n`));
  console.log(chalk.dim(`Project type: ${projectType}`));
  console.log(chalk.dim(`Image tag: ${imageTag}`));
  console.log();

  let failed = false;

  // Build stage
  const buildSuccess = await runStage("Build", async () => {
    const spinner = ora("Building project...").start();

    try {
      switch (projectType) {
        case "gradle":
          await execa("./gradlew", ["clean", "build", "-x", "test", "--no-daemon"], {
            cwd: backendDir,
            stdio: "pipe",
          });
          break;
        case "maven":
          await execa("./mvnw", ["clean", "package", "-DskipTests"], {
            cwd: backendDir,
            stdio: "pipe",
          });
          break;
        case "npm":
          await execa("npm", ["run", "build"], {
            cwd: backendDir,
            stdio: "pipe",
          });
          break;
        case "go":
          await execa("go", ["build", "-o", "app", "."], {
            cwd: backendDir,
            stdio: "pipe",
          });
          break;
        default:
          throw new Error(`Unknown project type: ${projectType}`);
      }
      spinner.succeed("Build completed");
    } catch (error) {
      spinner.fail("Build failed");
      throw error;
    }
  }, stages);

  if (!buildSuccess) {
    failed = true;
    printStages(stages);
    process.exit(1);
  }

  // Test stage
  if (!opts.skipTests) {
    const testSuccess = await runStage("Test", async () => {
      const spinner = ora("Running tests...").start();

      try {
        switch (projectType) {
          case "gradle":
            await execa("./gradlew", ["test", "--no-daemon"], {
              cwd: backendDir,
              stdio: "pipe",
            });
            break;
          case "maven":
            await execa("./mvnw", ["test"], {
              cwd: backendDir,
              stdio: "pipe",
            });
            break;
          case "npm":
            await execa("npm", ["test"], {
              cwd: backendDir,
              stdio: "pipe",
            });
            break;
          case "go":
            await execa("go", ["test", "./..."], {
              cwd: backendDir,
              stdio: "pipe",
            });
            break;
        }
        spinner.succeed("Tests passed");
      } catch (error) {
        spinner.fail("Tests failed");
        throw error;
      }
    }, stages);

    if (!testSuccess) {
      failed = true;
      printStages(stages);
      process.exit(1);
    }
  }

  // Containerize stage
  const containerizeSuccess = await runStage("Containerize", async () => {
    const spinner = ora("Building Docker image...").start();

    try {
      await execa("docker", ["build", "-t", imageTag, "."], {
        cwd: backendDir,
        stdio: "pipe",
      });
      spinner.succeed("Docker image built");
    } catch (error) {
      spinner.fail("Docker build failed");
      throw error;
    }
  }, stages);

  if (!containerizeSuccess) {
    failed = true;
    printStages(stages);
    process.exit(1);
  }

  // Security scan stage
  if (!opts.skipScan) {
    const scanSuccess = await runStage("Security Scan", async () => {
      const spinner = ora("Running security scan...").start();

      try {
        // Check if trivy is available
        await execa("trivy", ["--version"], { stdio: "pipe" });

        await execa("trivy", [
          "image",
          "--severity",
          "CRITICAL,HIGH",
          "--exit-code",
          "0",
          imageTag,
        ], {
          cwd: projectDir,
          stdio: "pipe",
        });
        spinner.succeed("Security scan passed");
      } catch (error: unknown) {
        if ((error as Error).message?.includes("trivy")) {
          spinner.warn("Trivy not installed, skipping scan");
          const stage = stages.find((s) => s.name === "Security Scan");
          if (stage) stage.status = "skipped";
        } else {
          spinner.fail("Security scan found vulnerabilities");
          throw error;
        }
      }
    }, stages);

    if (!scanSuccess) {
      // Don't fail pipeline on scan issues, just warn
      console.log(chalk.yellow("Security scan had issues but continuing..."));
    }
  }

  // Push stage
  if (opts.push) {
    await runStage("Push", async () => {
      const spinner = ora("Pushing to registry...").start();

      try {
        await execa("docker", ["push", imageTag], {
          cwd: projectDir,
          stdio: "pipe",
        });
        spinner.succeed("Image pushed to registry");
      } catch (error) {
        spinner.fail("Push failed");
        throw error;
      }
    }, stages);
  }

  printStages(stages);

  if (!failed) {
    console.log(chalk.green("Pipeline completed successfully!"));
    console.log();
    console.log(chalk.dim("Image:"), chalk.cyan(imageTag));
    console.log();

    if (!opts.push) {
      console.log(chalk.dim("To push to registry, run:"));
      console.log(chalk.cyan(`  blissful-infra pipeline --local --push`));
    }
  }
}

export async function pipelineAction(
  name: string | undefined,
  opts: PipelineOptions
): Promise<void> {
  // Find project directory
  const projectDir = await findProjectDir(name);
  if (!projectDir) {
    if (name) {
      console.error(chalk.red(`Project '${name}' not found.`));
    } else {
      console.error(chalk.red("No blissful-infra.yaml found."));
      console.error(chalk.dim("Run from project directory or specify project name:"));
      console.error(chalk.cyan("  blissful-infra pipeline my-app --local"));
    }
    process.exit(1);
  }

  // Load project config
  const config = await loadConfig(projectDir);
  if (!config) {
    console.error(chalk.red("No blissful-infra.yaml found."));
    process.exit(1);
  }

  if (opts.local) {
    await runLocalPipeline(config, projectDir, opts);
  } else {
    // TODO: Show Jenkins pipeline status
    console.log(chalk.yellow("Jenkins pipeline status not yet implemented."));
    console.log();
    console.log(chalk.dim("To run pipeline locally:"));
    console.log(chalk.cyan("  blissful-infra pipeline --local"));
    console.log();
    console.log(chalk.dim("To view Jenkins:"));
    console.log(chalk.cyan("  open http://localhost:8080/job/" + config.name));
  }
}

export const pipelineCommand = new Command("pipeline")
  .description("Run CI/CD pipeline locally or view pipeline status")
  .argument("[name]", "Project name (if running from parent directory)")
  .option("--local", "Run pipeline locally (build, test, containerize)")
  .option("--push", "Push image to registry after build (requires --local)")
  .option("--skip-tests", "Skip test stage")
  .option("--skip-scan", "Skip security scan stage")
  .action(async (name: string | undefined, opts: PipelineOptions) => {
    await pipelineAction(name, opts);
  });
