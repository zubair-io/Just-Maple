import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { subscriptionEnvironment } from "./environment.js";

export async function findExecutable(name, environment = process.env) {
  for (const directory of (environment.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return null;
}

export function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = spawn(executable, args, {
      cwd: options.cwd ?? process.cwd(),
      env: subscriptionEnvironment(options.env),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs ?? 10_000);
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? -1,
        signal,
        durationMs: Math.round(performance.now() - startedAt)
      });
    });
  });
}
