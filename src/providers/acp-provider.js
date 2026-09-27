import path from "node:path";
import { fileURLToPath } from "node:url";
import * as acp from "@agentclientprotocol/sdk";
import { findExecutable, run } from "./process.js";

export class ACPProvider {
  constructor(configuration) {
    Object.assign(this, configuration);
    this.process = null;
    this.connection = null;
    this.session = null;
    this.stderr = "";
    this.events = [];
    this.initialization = null;
  }

  async detect() {
    const [cliPath, adapterInstalled] = await Promise.all([
      findExecutable(this.cli),
      this.adapterAvailable()
    ]);
    if (!cliPath) {
      return { installed: false, adapterInstalled, authenticated: false };
    }

    const [version, authentication] = await Promise.all([
      run(cliPath, this.versionArgs),
      run(cliPath, this.authArgs)
    ]);
    const auth = this.parseAuthentication(authentication);
    return {
      installed: true,
      adapterInstalled,
      authenticated: auth.authenticated,
      authMethod: auth.authMethod,
      version: version.stdout.trim() || version.stderr.trim() || undefined,
      error: auth.error
    };
  }

  async adapterAvailable() {
    try {
      await accessAdapter(this.adapterPath);
      return true;
    } catch {
      return false;
    }
  }

  // ACP permission callbacks do not disable native tools. The pinned Codex
  // adapter has no verified tool-free contract, so do not launch or submit data.
  async start() { throw isolationUnsupported(); }
  async send() { throw isolationUnsupported(); }

  async archiveSession() {
    if (this.id !== "codex" || !this.session || !this.connection || this.archivedSession === this.session.sessionId) return;
    // In the pinned Codex ACP adapter, session/delete calls thread/archive.
    // This retains history; it does not permanently delete a ChatGPT project.
    const id = this.session.sessionId;
    await Promise.race([
      this.connection.agent.request(acp.methods.agent.session.delete, { sessionId: id }),
      timeoutAfter(10_000, "Could not archive the temporary Codex session.")
    ]);
    this.archivedSession = id;
  }

  async cancel() {
    if (!this.session || !this.connection) return;
    await this.connection.agent.notify(acp.methods.agent.session.cancel, {
      sessionId: this.session.sessionId
    });
  }

  async close() {
    this.session?.dispose();
    this.session = null;
    const process = this.process;
    this.connection?.close();
    this.connection = null;
    this.process = null;
    if (process && process.exitCode === null) {
      process.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => process.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 1_000))
      ]);
      if (process.exitCode === null) process.kill("SIGKILL");
    }
  }
}

async function accessAdapter(adapterPath) {
  const { access } = await import("node:fs/promises");
  return access(adapterPath);
}

function timeoutAfter(milliseconds, message) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref?.();
  });
}

export function adapterEntry(packageName) {
  const packageDirectory = path.dirname(fileURLToPath(import.meta.resolve(`${packageName}/package.json`)));
  return path.join(packageDirectory, "dist", "index.js");
}

function isolationUnsupported() {
  const error = new Error('ChatGPT extraction is unavailable: the installed Codex adapter has no verified tool-free mode. Choose Claude or another provider.');
  error.code = 'PROVIDER_ISOLATION_UNSUPPORTED';
  return error;
}
