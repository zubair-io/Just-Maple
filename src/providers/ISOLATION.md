# Text-only subscription extraction

Claude extraction uses the pinned `@anthropic-ai/claude-agent-sdk` 0.3.274 directly; local `claude auth status` still verifies a claude.ai subscription. The user's CLI and existing OAuth login remain in use. The old ACP session defaults are no longer used for extraction.

The SDK contract explicitly defines `tools: []` as removing all built-in tools. `strictMcpConfig: true` plus empty servers ignores inherited MCP definitions. Empty settings sources, safe mode, disabled skills, no plugins/agents, and a custom system prompt avoid project/user customizations. Permission and PreToolUse callbacks deny every tool as additional guards; they are not the primary isolation mechanism. The SDK's actual spawn arguments are tested offline at its injected process boundary. Returned initialization must advertise zero tools and zero MCP servers, and unexpected tool-use messages fail the request. Unsupported CLI flags fail normally without fallback. A session is never resumed or persisted by this request.

Trusted administrator-managed policy still applies to the CLI (including policy hooks). This is a boundary against model-invoked tools on untrusted input, not an OS sandbox or a guarantee that the authenticated CLI performs no internal filesystem/network operations. `--bare` is deliberately not used because it disables OAuth/keychain auth. No live private prompt was used in these tests.

ChatGPT extraction is restored through the existing Codex ACP 1.12.0 transport at the user's request. It selects the adapter's `read-only` approval mode before submitting a prompt and rejects permission requests. This mode still retains native tools and is not advertised as tool-free. The stable Provider Workspace and fresh session per request remain; successful sessions are archived before returning the result, with cleanup retried for failed/interrupted requests. Archive failure is not silently reported as successful extraction. No automatic reply-sending feature is introduced.

The regression suite exercises the actual ACP SDK over a synthetic stdio adapter: streamed extraction, mode selection before prompts, single-session archiving, prompt errors, cancellation, and interrupted cleanup. A live synthetic request through the ChatGPT login returned structured text and completed session archival. All four live synthetic task-parser cases also passed: incoming promise, outgoing promise, tentative plan, and direct request. This verifies connectivity, lifecycle and the narrow rubric, not broad extraction accuracy.

Primary local source evidence:

- Claude SDK `sdk.d.ts`: `Options.tools`, `Options.strictMcpConfig`, `Options.settingSources`, `Options.persistSession`.
- Installed Claude CLI `--help`: `--tools`, `--safe-mode`, `--disable-slash-commands`, `--bare`.
- Codex ACP `dist/index.js`: `AgentMode.DEFAULT_AGENT_MODE`, `AgentMode.ReadOnly`, `createSessionConfig`.

Run `npm test --prefix src/providers`. The tests use synthetic strings, a mocked query executor, and the real pinned SDK with a throwing mock spawn; they never call a live model or mutate a user's data.
