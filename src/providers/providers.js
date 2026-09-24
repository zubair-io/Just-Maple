import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACPProvider, adapterEntry } from "./acp-provider.js";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));

export const providers = Object.freeze({
  claude: new ACPProvider({
    id: "claude",
    displayName: "Claude",
    cli: "claude",
    adapterPath: adapterEntry("@agentclientprotocol/claude-agent-acp"),
    adapterEnvironment(cliPath) {
      return {
        CLAUDE_CODE_EXECUTABLE: path.join(sourceDirectory, "claude-subscription-wrapper.js"),
        POC_REAL_CLAUDE_EXECUTABLE: cliPath
      };
    },
    versionArgs: ["--version"],
    authArgs: ["auth", "status"],
    parseAuthentication(result) {
      try {
        const status = JSON.parse(result.stdout || result.stderr);
        const authenticated = result.exitCode === 0 && status.loggedIn === true && status.authMethod === "claude.ai";
        return {
          authenticated,
          authMethod: status.authMethod,
          error: authenticated ? undefined : "Claude must be logged in through claude.ai."
        };
      } catch {
        return { authenticated: "unknown", error: "Could not parse Claude authentication status." };
      }
    }
  }),
  codex: new ACPProvider({
    id: "codex",
    displayName: "Codex",
    cli: "codex",
    adapterPath: adapterEntry("@agentclientprotocol/codex-acp"),
    versionArgs: ["--version"],
    authArgs: ["login", "status"],
    parseAuthentication(result) {
      const output = `${result.stdout}\n${result.stderr}`.trim();
      const authenticated = result.exitCode === 0 && /logged in using chatgpt/i.test(output);
      return {
        authenticated,
        authMethod: authenticated ? "ChatGPT" : undefined,
        error: authenticated ? undefined : output || "Codex is not logged in through ChatGPT."
      };
    }
  })
});

export function providerNamed(name) {
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown provider '${name}'. Expected claude or codex.`);
  return provider;
}
