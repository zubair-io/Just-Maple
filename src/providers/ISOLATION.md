# Text-only subscription extraction

Claude extraction uses the pinned `@anthropic-ai/claude-agent-sdk` 0.3.274 directly; local `claude auth status` still verifies a claude.ai subscription. The user's CLI and existing OAuth login remain in use. The old ACP session defaults are no longer used for extraction.

The SDK contract explicitly defines `tools: []` as removing all built-in tools. `strictMcpConfig: true` plus empty servers ignores inherited MCP definitions. Empty settings sources, safe mode, disabled skills, no plugins/agents, and a custom system prompt avoid project/user customizations. Permission and PreToolUse callbacks deny every tool as additional guards; they are not the primary isolation mechanism. The SDK's actual spawn arguments are tested offline at its injected process boundary. Returned initialization must advertise zero tools and zero MCP servers, and unexpected tool-use messages fail the request. Unsupported CLI flags fail normally without fallback. A session is never resumed or persisted by this request.

Trusted administrator-managed policy still applies to the CLI (including policy hooks). This is a boundary against model-invoked tools on untrusted input, not an OS sandbox or a guarantee that the authenticated CLI performs no internal filesystem/network operations. `--bare` is deliberately not used because it disables OAuth/keychain auth. No live private prompt was used in these tests.

ChatGPT login detection remains supported. Codex ACP 1.12.0 extraction fails closed before spawn or prompt submission: its Agent/default and ReadOnly modes retain native tool capability, permission callbacks are not called for all tools, and its session configuration can inherit MCP servers. The inspected adapter has no verified all-tools-disabled session contract. Disabling shell/search individually is not proof that file tools, apply_patch, MCP or future tools are unavailable. Enable extraction only after implementing and testing a complete tool-free provider contract; do not fall back to Agent or a read-only filesystem sandbox.

Primary local source evidence:

- Claude SDK `sdk.d.ts`: `Options.tools`, `Options.strictMcpConfig`, `Options.settingSources`, `Options.persistSession`.
- Installed Claude CLI `--help`: `--tools`, `--safe-mode`, `--disable-slash-commands`, `--bare`.
- Codex ACP `dist/index.js`: `AgentMode.DEFAULT_AGENT_MODE`, `AgentMode.ReadOnly`, `createSessionConfig`.

Run `npm test --prefix src/providers`. The tests use synthetic strings, a mocked query executor, and the real pinned SDK with a throwing mock spawn; they never call a live model or mutate a user's data.
