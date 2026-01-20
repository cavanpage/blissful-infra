import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import {
  checkOllamaRunning,
  selectModel,
  chat,
  chatStream,
  type ChatMessage,
} from "../utils/ollama.js";
import {
  collectContext,
  formatContextForPrompt,
  type CollectedContext,
} from "../utils/collectors.js";
import { loadConfig } from "../utils/config.js";

const SYSTEM_PROMPT = `You are a helpful infrastructure assistant for the blissful-infra project. You help developers understand their application logs, diagnose issues, and suggest improvements.

When analyzing logs or issues:
1. Look for error messages, exceptions, and stack traces
2. Identify patterns in the logs (repeated errors, timing issues)
3. Correlate with recent code changes if commits are provided
4. Suggest specific, actionable fixes when possible

Keep responses concise and focused. Use markdown formatting for code blocks and lists.`;

interface AgentOptions {
  query?: string;
  model?: string;
}

async function findProjectDir(name?: string): Promise<string | null> {
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

async function runSingleQuery(
  query: string,
  model: string,
  context: CollectedContext
): Promise<void> {
  const spinner = ora("Analyzing...").start();

  try {
    const contextText = formatContextForPrompt(context);
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `${contextText}\n\n---\n\nQuestion: ${query}`,
      },
    ];

    const response = await chat(model, messages);
    spinner.stop();

    console.log();
    console.log(response);
    console.log();
  } catch (error) {
    spinner.fail("Analysis failed");
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
  }
}

async function runInteractiveMode(
  model: string,
  context: CollectedContext,
  projectDir: string
): Promise<void> {
  console.log();
  console.log(chalk.bold("Blissful Infra Agent"));
  console.log(chalk.dim(`Model: ${model}`));
  console.log(chalk.dim(`Context: ${context.logs.length} log entries, ${context.commits.length} commits`));
  console.log(chalk.dim('Type "help" for commands, "exit" to quit'));
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const history: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  // Add initial context
  const contextText = formatContextForPrompt(context);
  if (contextText) {
    history.push({
      role: "user",
      content: `Here is the current context from the project:\n\n${contextText}\n\nI'll be asking you questions about this. Please acknowledge.`,
    });
    history.push({
      role: "assistant",
      content: "I've reviewed the logs and recent commits. I'm ready to help you analyze issues, understand the logs, or answer questions about your infrastructure. What would you like to know?",
    });
  }

  const prompt = (): void => {
    rl.question(chalk.cyan("> "), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      // Handle special commands
      if (trimmed === "exit" || trimmed === "quit") {
        console.log(chalk.dim("Goodbye!"));
        rl.close();
        return;
      }

      if (trimmed === "help") {
        console.log();
        console.log(chalk.bold("Commands:"));
        console.log(chalk.dim("  help     ") + "Show this help");
        console.log(chalk.dim("  refresh  ") + "Refresh logs and context");
        console.log(chalk.dim("  logs     ") + "Show recent logs");
        console.log(chalk.dim("  commits  ") + "Show recent commits");
        console.log(chalk.dim("  clear    ") + "Clear conversation history");
        console.log(chalk.dim("  exit     ") + "Exit the agent");
        console.log();
        console.log(chalk.bold("Example questions:"));
        console.log(chalk.dim('  "What errors are in the logs?"'));
        console.log(chalk.dim('  "Why might the app be failing to start?"'));
        console.log(chalk.dim('  "What changed in the last few commits?"'));
        console.log();
        prompt();
        return;
      }

      if (trimmed === "refresh") {
        const spinner = ora("Refreshing context...").start();
        const newContext = await collectContext(projectDir);
        context.logs = newContext.logs;
        context.commits = newContext.commits;
        spinner.succeed(
          `Refreshed: ${context.logs.length} logs, ${context.commits.length} commits`
        );
        prompt();
        return;
      }

      if (trimmed === "logs") {
        console.log();
        if (context.logs.length === 0) {
          console.log(chalk.dim("No logs collected."));
        } else {
          const recent = context.logs.slice(-20);
          for (const log of recent) {
            console.log(
              chalk.dim(`[${log.service}]`) + " " + log.message.slice(0, 100)
            );
          }
          if (context.logs.length > 20) {
            console.log(chalk.dim(`... and ${context.logs.length - 20} more`));
          }
        }
        console.log();
        prompt();
        return;
      }

      if (trimmed === "commits") {
        console.log();
        if (context.commits.length === 0) {
          console.log(chalk.dim("No commits found."));
        } else {
          for (const commit of context.commits) {
            console.log(
              chalk.yellow(commit.sha.slice(0, 7)) +
                " " +
                chalk.dim(`(${commit.author})`) +
                " " +
                commit.message
            );
          }
        }
        console.log();
        prompt();
        return;
      }

      if (trimmed === "clear") {
        // Reset history but keep system prompt
        history.length = 1;
        console.log(chalk.dim("Conversation history cleared."));
        prompt();
        return;
      }

      // Regular query - send to LLM
      history.push({ role: "user", content: trimmed });

      process.stdout.write(chalk.dim("\n"));

      try {
        let response = "";
        for await (const chunk of chatStream(model, history)) {
          process.stdout.write(chunk);
          response += chunk;
        }
        process.stdout.write("\n\n");

        history.push({ role: "assistant", content: response });
      } catch (error) {
        console.log();
        if (error instanceof Error) {
          console.error(chalk.red(`Error: ${error.message}`));
        }
        // Remove failed user message from history
        history.pop();
      }

      prompt();
    });
  };

  prompt();
}

export async function agentAction(name?: string, opts: AgentOptions = {}): Promise<void> {
  // Check Ollama is running
  const ollamaRunning = await checkOllamaRunning();
  if (!ollamaRunning) {
    console.error(chalk.red("Ollama is not running."));
    console.error(chalk.dim("Please start Ollama and try again:"));
    console.error(chalk.cyan("  ollama serve"));
    console.error();
    console.error(chalk.dim("Install Ollama from: https://ollama.ai"));
    process.exit(1);
  }

  // Select model
  const model = opts.model || (await selectModel());
  if (!model) {
    console.error(chalk.red("No language models available in Ollama."));
    console.error(chalk.dim("Pull a model first:"));
    console.error(chalk.cyan("  ollama pull llama3.1:8b"));
    process.exit(1);
  }

  // Find project directory
  const projectDir = await findProjectDir(name);
  if (!projectDir) {
    if (name) {
      console.error(chalk.red(`Project '${name}' not found.`));
    } else {
      console.error(chalk.red("No blissful-infra.yaml found."));
      console.error(chalk.dim("Run from project directory or specify project name:"));
      console.error(chalk.cyan("  blissful-infra agent my-app"));
    }
    process.exit(1);
  }

  // Collect context
  const spinner = ora("Collecting context...").start();
  const context = await collectContext(projectDir);
  spinner.succeed(context.summary);

  // Run in query mode or interactive mode
  if (opts.query) {
    await runSingleQuery(opts.query, model, context);
  } else {
    await runInteractiveMode(model, context, projectDir);
  }
}

export const agentCommand = new Command("agent")
  .description("AI-powered infrastructure assistant")
  .argument("[name]", "Project name (if running from parent directory)")
  .option("-q, --query <query>", "Single query mode (non-interactive)")
  .option("-m, --model <model>", "Override model selection")
  .action(async (name: string | undefined, opts: AgentOptions) => {
    await agentAction(name, opts);
  });
