import { TestBed } from "@angular/core/testing";
import { afterEach, expect, it, vi } from "vitest";
import { SourceReferenceComponent } from "./source-reference.component";
import { SourcesService } from "../sources/sources.service";

afterEach(() => TestBed.resetTestingModule());
it("renders a captured HA update, its reason and date, and opens the shared inspector", async () => {
  TestBed.configureTestingModule({providers: [{provide: SourcesService, useValue: {detail: async () => ({row: {
    id: "fixture-batch", connector: "home_assistant", type: "home.batch", sender: "Synthetic home",
    subject: "Home update", preview: "Observed changes · Fixture lamp: off → on; +1 more entities; inspect batch evidence",
    attentionReason: "For your information", occurredAt: "2026-09-29T12:00:00Z", status: "complete",
  }})}}]});
  const fixture = TestBed.createComponent(SourceReferenceComponent);
  fixture.componentRef.setInput("reference", {v: 1, kind: "home", eventID: "fixture-batch", label: "Home update"});
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const text = fixture.nativeElement.textContent;
  expect(text).toContain("For your information");
  expect(text).toContain("Fixture lamp: off → on");
  expect(text).toContain("+1 more entities");
  expect(fixture.nativeElement.querySelector("time").textContent).toContain("Sep 29");
  const inspect = vi.fn(); fixture.componentInstance.inspected.subscribe(inspect);
  fixture.nativeElement.querySelector(".source-card-title").click();
  expect(inspect).toHaveBeenCalledWith("fixture-batch");
  fixture.destroy();
});
it("retains the saved reference label if its evidence becomes unavailable", async () => {
  TestBed.configureTestingModule({providers: [{provide: SourcesService, useValue: {detail: async () => {throw Error("unavailable");}}}]});
  const fixture = TestBed.createComponent(SourceReferenceComponent);
  fixture.componentRef.setInput("reference", {v: 1, kind: "email", eventID: "fixture-email", label: "Saved subject"});
  fixture.detectChanges(); await vi.waitFor(() => expect(fixture.componentInstance.unavailable()).toBe(true)); fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain("Saved subject");
  expect(fixture.nativeElement.textContent).toContain("Source unavailable");
  fixture.destroy();
});
