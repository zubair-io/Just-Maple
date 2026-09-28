import { describe, it, expect } from "vitest";
import { sourceReferenceKind } from "./source-reference-kind";
describe("source reference routing", () => {
  it("uses connector identity when mail and chat share an event type", () => {
    expect(
      sourceReferenceKind({ connector: "gmail", type: "message.received" }),
    ).toBe("email");
    expect(
      sourceReferenceKind({ connector: "imessage", type: "message.received" }),
    ).toBe("message");
    expect(
      sourceReferenceKind({ connector: "home_assistant", type: "home.state" }),
    ).toBe("home");
    expect(
      sourceReferenceKind({ connector: "home_assistant", type: "home.batch" }),
    ).toBe("home");
    expect(
      sourceReferenceKind({
        connector: "apple_calendar",
        type: "event.updated",
      }),
    ).toBe("calendar");
  });
});
