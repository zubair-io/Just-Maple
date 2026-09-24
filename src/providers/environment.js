const API_KEY_VARIABLES = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_ADMIN_KEY",
  "CODEX_API_KEY"
];

export function subscriptionEnvironment(source = process.env) {
  const environment = { ...source };
  for (const name of API_KEY_VARIABLES) delete environment[name];
  return environment;
}
