import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter } from "@angular/router";
import { WorkspaceComponent } from "./workspace.component";
import { ConnectionsComponent } from "./connections.component";
import { NativeBridge, emptySnapshot } from "../core/native-bridge.service";
import { describe, it, expect, vi } from "vitest";

async function setup(page: string) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { data: { page } } } },
    ],
  });
  const bridge = TestBed.inject(NativeBridge);
  bridge.state.set({ ...emptySnapshot, loaded: true, step: -1, name: "Test" });
  const fixture = TestBed.createComponent(WorkspaceComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  return { bridge, fixture };
}
describe("Angular workspace state", () => {
  it("keeps the same expanded calendar element when fresh snapshots reorder events", async () => {
    const { bridge, fixture } = await setup("Calendar");
    const event = {
      id: "calendar:one",
      name: "Planning",
      content: "Source detail",
      start: 200,
      end: 300,
    };
    bridge.state.update((s) => ({ ...s, appleCalendar: [event] }));
    fixture.detectChanges();
    const first = fixture.nativeElement.querySelector(
      '[data-event-id="calendar:one"]',
    );
    const details = first.querySelector("details");
    details.open = true;
    bridge.state.update((s) => ({
      ...s,
      appleCalendar: [
        { ...event, start: 201 },
        { ...event, id: "calendar:two", start: 100 },
      ],
    }));
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-event-id="calendar:one"]'),
    ).toBe(first);
    expect(details.open).toBe(true);
  });
  it("preserves note drafts across polls and only clears after a successful native save", async () => {
    const { bridge, fixture } = await setup("Notes");
    const input = fixture.nativeElement.querySelector("textarea");
    input.value = "An unfinished thought";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    await fixture.whenStable();
    bridge.state.update((s) => ({ ...s, count: 80 }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("textarea").value).toBe(
      "An unfinished thought",
    );
    const act = vi.spyOn(bridge, "act").mockResolvedValue(false);
    await fixture.componentInstance.saveNote();
    expect(fixture.componentInstance.note).toBe("An unfinished thought");
    act.mockResolvedValue(true);
    await fixture.componentInstance.saveNote();
    expect(fixture.componentInstance.note).toBe("");
  });
  it("shows self facts on Me without mislabeling contact facts", async () => {
    const { bridge, fixture } = await setup("Me");
    const fact = {
      id: "self",
      subject: "person:self",
      predicate: "name",
      value: "Self assertion",
      sourceQuote: "evidence",
      provider: "local",
      eventID: "event",
    };
    bridge.state.update((s) => ({
      ...s,
      facts: [
        fact,
        {
          ...fact,
          id: "contact",
          subject: "person:google:123",
          value: "Contact assertion",
        },
      ],
    }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Self assertion");
    expect(fixture.nativeElement.textContent).not.toContain(
      "Contact assertion",
    );
  });
  it("retains unsaved multi-select changes when a poll returns saved calendars", async () => {
    TestBed.configureTestingModule({});
    const bridge = TestBed.inject(NativeBridge);
    bridge.state.set({ ...emptySnapshot, selectedCalendarIDs: ["one"] });
    const fixture = TestBed.createComponent(ConnectionsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.toggle("apple", "two", true);
    bridge.state.update((s) => ({
      ...s,
      selectedCalendarIDs: ["one"],
      count: 10,
    }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.appleSelection).toEqual(["one", "two"]);
  });
  it("escapes source text instead of interpreting HTML", async () => {
    const { fixture } = await setup("Search");
    fixture.componentInstance.results.set([
      {
        id: "one",
        content: "<img src=x onerror=alert(1)>",
        type: "note",
        source: { connector: "notes" },
      },
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("article img")).toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      "<img src=x onerror=alert(1)>",
    );
  });
});
