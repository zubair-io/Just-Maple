import { query } from '@anthropic-ai/claude-agent-sdk';
import { ACPProvider } from './acp-provider.js';
import { subscriptionEnvironment } from './environment.js';
import { findExecutable } from './process.js';

export class ProviderIsolationError extends Error {
  constructor(message = 'Provider did not establish a text-only session.') {
    super(message);
    this.code = 'PROVIDER_ISOLATION_UNSUPPORTED';
  }
}

// Empty allowedTools alone is NOT an allowlist. tools: [] removes the model's
// built-in tool definitions; strict MCP prevents inherited servers supplying more.
export function textOnlyOptions({ cwd, executable, abortController }) {
  const env = subscriptionEnvironment();
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_MODEL;
  delete env.CLAUDE_CODE_EXECUTABLE;
  return {
    cwd, pathToClaudeCodeExecutable: executable, abortController,
    env, model: 'sonnet', tools: [], mcpServers: {}, strictMcpConfig: true,
    settingSources: [], plugins: [], agents: {}, persistSession: false,
    permissionMode: 'dontAsk', allowDangerouslySkipPermissions: false,
    systemPrompt: 'Analyze only the supplied text. Return the requested answer. You have no tools or actions.',
    extraArgs: { 'safe-mode': null, 'disable-slash-commands': null },
    settings: { disableAllHooks: true, syncClaudeAiSkills: false, syncClaudeAiPlugins: false },
    canUseTool: async () => ({ behavior: 'deny', message: 'Tools are disabled for text extraction.' }),
    hooks: { PreToolUse: [{ hooks: [async () => ({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
        permissionDecisionReason: 'Tools are disabled for text extraction.' }
    })] }] }
  };
}

export class ClaudeTextProvider extends ACPProvider {
  constructor(configuration, dependencies = {}) {
    super(configuration);
    this.queryText = dependencies.query ?? query;
    this.findCLI = dependencies.findExecutable ?? findExecutable;
  }

  async send(prompt, options = {}) {
    if (this.textQuery) throw new Error('Provider request already running.');
    const executable = await this.findCLI(this.cli);
    if (!executable) throw new Error('Claude CLI is not installed.');
    const controller = new AbortController();
    this.textController = controller;
    const started = performance.now();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 180_000);
    timer.unref?.();
    let initialized = false, result;
    try {
      this.textQuery = this.queryText({ prompt,
        options: textOnlyOptions({ cwd: options.cwd, executable, abortController: controller }) });
      for await (const message of this.textQuery) {
        if (message.type === 'system' && message.subtype === 'init') {
          // Fail closed if a CLI version ignores flags or policy adds tools.
          if (!Array.isArray(message.tools) || message.tools.length !== 0 ||
              !Array.isArray(message.mcp_servers) || message.mcp_servers.length !== 0) {
            throw new ProviderIsolationError();
          }
          initialized = true;
        } else if (message.type === 'assistant') {
          if (!initialized || message.message?.content?.some(block => block.type === 'tool_use' || block.type === 'server_tool_use')) {
            throw new ProviderIsolationError();
          }
        } else if (message.type === 'result') {
          if (!initialized) throw new ProviderIsolationError();
          if (message.subtype !== 'success' || message.is_error || typeof message.result !== 'string') {
            throw new Error('Claude did not complete text extraction.');
          }
          result = { text: message.result.trim(), durationMs: Math.round(performance.now() - started),
            raw: { sessionId: message.session_id, stopReason: 'end_turn', events: [], stderr: '', exitCode: null } };
        }
      }
      if (!result) throw new Error('Claude returned no completed answer.');
      return result;
    } finally {
      clearTimeout(timer);
      controller.abort();
      this.textQuery?.close?.();
      this.textQuery = null;
      this.textController = null;
    }
  }
  async cancel() { this.textController?.abort(); }
  async close() { await this.cancel(); this.textQuery?.close?.(); await super.close(); }
}
