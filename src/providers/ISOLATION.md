# Text-only subscription extraction

Claude extraction uses the pinned `@anthropic-ai/claude-agent-sdk` 0.3.274 directly; local `claude auth status` still verifies a claude.ai subscription. The user's CLI and existing OAuth login remain in use. The old ACP session defaults are no longer used for extraction.

The SDK contract explicitly defines `tools: []` as removing all built-in tools. `strictMcpConfig: true` plus empty servers ignores inherited MCP definitions. Empty settings sources, safe mode, disabled skills, no plugins/agents, and a custom system prompt avoid project/user customizations. Permission and PreToolUse callbacks deny every tool as additional guards; they are not the primary isolation mechanism. The SDK's actual spawn arguments are tested offline at its injected process boundary. Returned initialization must advertise zero tools and zero MCP servers, and unexpected tool-use messages fail the request. Unsupported CLI flags fail normally without fallback. A session is never resumed or persisted by this request.

Trusted administrator-managed policy still applies to the CLI (including policy hooks). This is a boundary against model-invoked tools on untrusted input, not an OS sandbox or a guarantee that the authenticated CLI performs no internal filesystem/network operations. `--bare` is deliberately not used because it disables OAuth/keychain auth. No live private prompt was used in these tests.

ChatGPT extraction is restored through the existing Codex ACP 1.12.0 transport at the user's request. It selects the adapter's `read-only` approval mode before submitting a prompt and rejects permission requests. This mode still retains native tools and is not advertised as tool-free. The stable Provider Workspace and fresh session per request remain; successful sessions are archived before returning the result, with cleanup retried for failed/interrupted requests. Archive failure is not silently reported as successful extraction. No automatic reply-sending feature is introduced.

The adapter now runs the same Codex executable checked by detection. Before a prompt, Maple keeps a supported inherited model, or uses an explicit per-request model override. If the inherited model is unavailable, it may use only the adapter's explicitly recommended, advertised model for this new session. Unsupported explicit choices and missing recommendations fail before inference. The user's global configuration is never changed and a failed prompt is never retried on a substitute model. With pinned adapter 1.12, unavailable inherited models are synthetic display entries with `description: null`; they are excluded from availability checks. Effective model metadata is returned on both success and provider failure; native fact/task invocation artifacts retain it separately from the prospective subscription-default selection label.

The client opts into the pinned adapter's AIR v1 typed session-failure extension. Error updates and terminal error metadata fail the request even if the ACP stop reason is `end_turn`; warnings alone do not discard a later successful result. This prevents an HTTP/model error being treated as task JSON and triggering an unnecessary repair call. Error messages are mapped to fixed safe text and do not expose provider diagnostics or source content.

The regression suite exercises the actual ACP SDK over a synthetic stdio adapter: streamed extraction, mode selection before prompts, single-session archiving, prompt errors, cancellation, and interrupted cleanup. A live synthetic request through the ChatGPT login returned structured text and completed session archival. All four live synthetic task-parser cases also passed: incoming promise, outgoing promise, tentative plan, and direct request. This verifies connectivity, lifecycle and the narrow rubric, not broad extraction accuracy.

Primary local source evidence:

- Claude SDK `sdk.d.ts`: `Options.tools`, `Options.strictMcpConfig`, `Options.settingSources`, `Options.persistSession`.
- Installed Claude CLI `--help`: `--tools`, `--safe-mode`, `--disable-slash-commands`, `--bare`.
- Codex ACP `dist/index.js`: `AgentMode.DEFAULT_AGENT_MODE`, `AgentMode.ReadOnly`, `createSessionConfig`.

Run `npm test --prefix src/providers`. The tests use synthetic strings, a mocked query executor, and the real pinned SDK with a throwing mock spawn; they never call a live model or mutate a user's data.
