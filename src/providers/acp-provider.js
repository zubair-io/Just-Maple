import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as acp from "@agentclientprotocol/sdk";
import { subscriptionEnvironment } from "./environment.js";
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

  async start(options = {}) {
    if (this.connection) return this;
    if (!(await this.adapterAvailable())) {
      throw new Error(`${this.displayName} ACP adapter is not installed.`);
    }

    const cliPath = await findExecutable(this.cli);
    const providerEnvironment = this.adapterEnvironment?.(cliPath) ?? this.environment;
    const environment = subscriptionEnvironment({
      ...process.env,
      ...providerEnvironment,
      ...options.environment
    });
    this.process = spawn(process.execPath, [this.adapterPath], {
      cwd: options.cwd ?? process.cwd(),
      env: environment,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-32_000);
      // Raw provider diagnostics stay private; never forward them to UI logs.
    });

    const exited = new Promise((_, reject) => {
      this.process.once("error", reject);
      this.process.once("exit", (code, signal) => {
        if (this.connection) {
          reject(new Error(`${this.displayName} adapter exited (${code ?? signal}).`));
        }
      });
    });

    exited.catch(() => {});
    const stream = acp.ndJsonStream(
      Writable.toWeb(this.process.stdin),
      Readable.toWeb(this.process.stdout)
    );
    const client = acp.client({ name: "just-maple" })
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
        const rejection = params.options.find((option) => option.kind === "reject_once")
          ?? params.options.find((option) => option.kind.startsWith("reject"));
        if (!rejection) return { outcome: { outcome: "cancelled" } };
        return { outcome: { outcome: "selected", optionId: rejection.optionId } };
      });

    this.connection = client.connect(stream);
    try {
      this.initialization = await Promise.race([
        this.connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {}
        }),
        exited,
        timeoutAfter(20_000, `${this.displayName} ACP initialization timed out.`)
      ]);
      this.session = await Promise.race([
        this.connection.agent.buildSession(options.cwd ?? process.cwd()).start(),
        exited,
        timeoutAfter(30_000, `${this.displayName} ACP session creation timed out.`)
      ]);
      // Keep the restored transport in its explicit approval mode; our client
      // denies permission requests. This is not an all-tools-disabled contract.
      if (this.id === "codex") {
        await this.connection.agent.request(acp.methods.agent.session.setMode, {
          sessionId: this.session.sessionId, modeId: "read-only"
        });
      }
      return this;
    } catch (error) {
      // Retire a session even if configuration failed after its creation.
      try { await this.archiveSession(); } catch {}
      await this.close();
      throw error;
    }
  }

  async send(prompt, options = {}) {
    if (!this.session) await this.start(options);
    const startedAt = performance.now();
    const events = [];
    let text = "";
    let stopReason;

    const promptFailure = this.session.prompt(prompt).then(
      () => new Promise(() => {}),
      error => Promise.reject(error)
    );
    promptFailure.catch(() => {});

    const turn = (async () => {
      for (;;) {
        const message = await this.session.nextUpdate();
        if (message.kind === "stop") {
          stopReason = message.stopReason;
          break;
        }
        const event = message.update;
        events.push(event);
        options.onEvent?.(event);
        if (event.sessionUpdate === "agent_message_chunk" && event.content?.type === "text") {
          text += event.content.text;
          options.onText?.(event.content.text);
        }
      }
    })();

    try {
      await Promise.race([
        turn,
        promptFailure,
        timeoutAfter(options.timeoutMs ?? 180_000, `${this.displayName} response timed out.`)
      ]);
    } catch (error) {
      await this.cancel();
      throw error;
    }

    const result = {
      text: text.trim(),
      durationMs: Math.round(performance.now() - startedAt),
      raw: {
        sessionId: this.session.sessionId,
        stopReason,
        events,
        stderr: "",
        exitCode: null
      }
    };
    this.events.push(...events);
    return result;
  }

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
