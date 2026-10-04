import type { SourceRow } from "./sources.service";
/** The connector disambiguates email and chat: both ingest message.received. */
export function sourceReferenceKind(
  row: Pick<SourceRow, "type" | "connector">,
): string {
  const connector = row.connector.toLowerCase(),
    type = row.type.toLowerCase();
  if (
    ["gmail", "outlook", "email", "imap"].includes(connector) ||
    type.includes("email")
  )
    return "email";
  if (
    ["home_assistant", "home-assistant"].includes(connector) ||
    type.startsWith("home.")
  )
    return "home";
  if (connector.includes("recording") || type.includes("record")) return "recording";
  if (connector === "imessage" || type.includes("message")) return "message";
  if (connector.includes("calendar") || type.includes("calendar"))
    return "calendar";
  return "source";
}
