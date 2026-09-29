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
  expect(text).not.toContain("For your information");
  expect(text).not.toContain("home.batch");
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
it("matches the compact email layout with sender, subject and excerpt", async () => {
  TestBed.configureTestingModule({providers:[{provide:SourcesService,useValue:{detail:async()=>({row:{id:"email",connector:"gmail",type:"message.received",direction:"incoming",sender:'Dominick <fixture@example.invalid>',subject:"A few thoughts on the proposal",preview:"Can we talk through the timeline Monday?",occurredAt:"2026-09-29T12:00:00Z",status:"complete"}})}}]});
  const fixture=TestBed.createComponent(SourceReferenceComponent);
  fixture.componentRef.setInput("reference",{v:1,kind:"email",eventID:"email"});fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain("Dominick → you");
  expect(fixture.nativeElement.textContent).toContain("A few thoughts on the proposal");
  expect(fixture.nativeElement.textContent).not.toContain("message.received");
  expect(fixture.nativeElement.textContent).not.toContain("gmail");
  expect(fixture.nativeElement.querySelector("maple-icon")).toBeTruthy();fixture.destroy();
});
it("renders calendar occurrence details instead of import metadata", async () => {
  TestBed.configureTestingModule({providers:[{provide:SourcesService,useValue:{detail:async()=>({row:{id:"calendar",connector:"google_calendar",type:"calendar.snapshot",sender:"google_calendar",subject:"Design review",preview:"Google Calendar source record Start: technical metadata",occurredAt:"2026-09-01T12:00:00Z",calendar:{start:"2026-09-29T00:00:00Z",end:"2026-09-30T00:00:00Z",allDay:true,timeZone:"UTC",name:"Work",location:"Studio",notes:"Bring sketches"}}})}}]});
  const fixture=TestBed.createComponent(SourceReferenceComponent);
  fixture.componentRef.setInput("reference",{v:1,kind:"calendar",eventID:"calendar"});fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
  const text=fixture.nativeElement.textContent;
  for (const value of ["Work","Sep 29","All day","Studio","Bring sketches"]) expect(text).toContain(value);
  expect(text).not.toContain("source record");expect(text).not.toContain("Sep 1");fixture.destroy();
});
