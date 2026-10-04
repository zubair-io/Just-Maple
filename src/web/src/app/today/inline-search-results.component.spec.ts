import { TestBed } from "@angular/core/testing";
import { afterEach, expect, it, vi } from "vitest";
import { NativeBridge } from "../core/native-bridge.service";
import { InlineSearchPage, InlineSearchResultsComponent } from "./inline-search-results.component";

const cursor = { runID: "run", offset: 25, fingerprint: "snapshot" };
function page(offset = 0): InlineSearchPage {
  return { schemaVersion: 1, runID: "run", availability: "available", items: [{ eventID: `email-${offset}`, availability: "available", connector: "gmail", type: "message.received", title: "Synthetic proposal", excerpt: "Original captured text" }], total: 26, capturedCount: 26, offset, ...(offset ? {} : { nextCursor: cursor }), hasMoreMatches: false, asOf: 1790742042 };
}
function setup(handler: (action: string, data: any) => Promise<any> = async (_, data) => page(data.cursor?.offset)) {
  const notebook = vi.fn(handler);
  TestBed.configureTestingModule({ providers: [{ provide: NativeBridge, useValue: { notebook } }] });
  const fixture = TestBed.createComponent(InlineSearchResultsComponent);
  fixture.componentRef.setInput("runID", "run");
  fixture.componentRef.setInput("canInsert", true);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, notebook };
}
afterEach(() => TestBed.resetTestingModule());

it("pages original results forward/back without submitting a new run and inserts the chosen immutable reference", async () => {
  const { fixture, component, notebook } = setup();
  const insert = vi.fn(), inspect = vi.fn();
  component.insertRequested.subscribe(insert); component.inspected.subscribe(inspect);
  expect(notebook).not.toHaveBeenCalled();
  component.toggle(); await fixture.whenStable(); fixture.detectChanges();
  component.next(); await fixture.whenStable(); fixture.detectChanges();
  expect(component.page()?.offset).toBe(25);
  expect(notebook).toHaveBeenLastCalledWith("mapleSearchPage", { runID: "run", cursor });
  const buttons = [...fixture.nativeElement.querySelectorAll("button")] as HTMLButtonElement[];
  buttons.find(b => b.textContent === "Synthetic proposal")!.click();
  buttons.find(b => b.textContent === "Add to note")!.click();
  expect(inspect).toHaveBeenCalledWith("email-25");
  expect(insert).toHaveBeenCalledWith({ v: 1, eventID: "email-25", kind: "email", label: "Synthetic proposal" });
  component.back(); await fixture.whenStable();
  expect(component.page()?.offset).toBe(0);
  expect(notebook.mock.calls.every(([action]) => action === "mapleSearchPage")).toBe(true);
});

it("preserves the old page on failure and retries the requested cursor", async () => {
  let fail = true;
  const { fixture, component } = setup(async (_, data) => {
    if (data.cursor && fail) throw Error("Temporary read error");
    return page(data.cursor?.offset);
  });
  component.toggle(); await fixture.whenStable();
  component.next(); await fixture.whenStable();
  expect(component.page()?.offset).toBe(0);
  expect(component.error()).toContain("Temporary read error");
  fail = false; component.retry(); await fixture.whenStable();
  expect(component.page()?.offset).toBe(25);
  expect(component.previous()).toHaveLength(1);
});

it("ignores late results from a previous selected run", async () => {
  let finish!: (value: InlineSearchPage) => void;
  const { fixture, component } = setup(async () => new Promise(resolve => finish = resolve));
  component.toggle();
  fixture.componentRef.setInput("runID", "new-run"); fixture.detectChanges();
  finish(page()); await Promise.resolve();
  expect(component.page()).toBeNull();
  expect(component.expanded()).toBe(false);
});

it("shows capture limits and unavailable evidence without fake insert actions", async () => {
  const { fixture, component } = setup(async () => ({ ...page(), items: [{ eventID: "gone", availability: "missing", reason: "Source was removed" }], capturedCount: 5000, total: 6000, hasMoreMatches: true, message: "Only the first 5,000 matches were captured." }));
  component.toggle(); await fixture.whenStable(); fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain("first 5,000");
  expect(fixture.nativeElement.textContent).toContain("Source was removed");
  expect(fixture.nativeElement.textContent).not.toContain("Add to note");
});

it("keeps legacy runs truthful and disables insertion for a readonly editor", async () => {
  const { fixture, component } = setup(async () => ({ ...page(), availability: "not_recorded", items: [], message: "A pageable snapshot was not recorded." }));
  component.toggle(); await fixture.whenStable(); fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain("not recorded");
  const insert = vi.fn(); component.insertRequested.subscribe(insert);
  fixture.componentRef.setInput("canInsert", false); fixture.detectChanges();
  component.insert(page().items[0]);
  expect(insert).not.toHaveBeenCalled();
});
