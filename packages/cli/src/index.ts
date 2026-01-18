#!/usr/bin/env node

import { Command } from "commander";
import { createCommand } from "./commands/create.js";
import { upCommand } from "./commands/up.js";
import { downCommand } from "./commands/down.js";
import { logsCommand } from "./commands/logs.js";
import { devCommand } from "./commands/dev.js";

const program = new Command();

program
  .name("blissful-infra")
  .description("Infrastructure that thinks for itself")
  .version("0.1.0");

program.addCommand(createCommand);
program.addCommand(upCommand);
program.addCommand(downCommand);
program.addCommand(logsCommand);
program.addCommand(devCommand);

program.parse();
