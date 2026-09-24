#!/usr/bin/env node

import { spawn } from "node:child_process";

const executable = process.env.POC_REAL_CLAUDE_EXECUTABLE;
if (!executable) {
  console.error("POC_REAL_CLAUDE_EXECUTABLE is not set.");
  process.exit(127);
}

const environment = { ...process.env };
delete environment.CLAUDE_CODE_EXECUTABLE;
delete environment.POC_REAL_CLAUDE_EXECUTABLE;
delete environment.ANTHROPIC_API_KEY;
delete environment.ANTHROPIC_AUTH_TOKEN;
delete environment.ANTHROPIC_BASE_URL;
delete environment.ANTHROPIC_MODEL;

// The user's Claude settings currently redirect the CLI to a custom endpoint
// and placeholder model. These invocation-scoped settings neutralize those
// values without modifying ~/.claude/settings.json or touching credentials.
const subscriptionSettings = JSON.stringify({
  env: {
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_AUTH_TOKEN: "",
    ANTHROPIC_BASE_URL: "https://api.anthropic.com",
    ANTHROPIC_MODEL: "sonnet"
  }
});

const child = spawn(executable, [
  ...process.argv.slice(2),
  "--settings", subscriptionSettings,
  "--model", "sonnet"
], {
  env: environment,
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
