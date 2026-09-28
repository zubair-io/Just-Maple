import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { NavigationStart, provideRouter, Router } from "@angular/router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppComponent } from "./app.component";
import { NativeBridge } from "./core/native-bridge.service";
import { TodayDocumentService } from "./today/today-document.service";
import { NotebookService } from "./notebooks/notebook.service";

@Component({ standalone: true, template: "Sources remains open" })
class SourcesStub {}
function shell(flush = vi.fn().mockResolvedValue(true)) {
  const bridge = {
    state: signal<any>({
      loaded: true,
      step: -1,
      name: "",
      error: "",
      message: "",
    }),
    error: signal(""),
    pending: signal(false),
    start: vi.fn(),
    act: vi.fn().mockResolvedValue(true),
  };
  const notebooks = {
    catalog: signal({ notebooks: [] }),
    refresh: vi.fn(),
    selectBook: vi.fn().mockResolvedValue(undefined),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: "sources", component: SourcesStub },
        { path: "today/:day", component: SourcesStub },
      ]),
      { provide: NativeBridge, useValue: bridge },
      {
        provide: TodayDocumentService,
        useValue: { flush, day: signal("2026-09-27") },
      },
      { provide: NotebookService, useValue: notebooks },
    ],
  });
  const fixture = TestBed.createComponent(AppComponent);
  fixture.detectChanges();
  return {
    fixture,
    component: fixture.componentInstance,
    router: TestBed.inject(Router),
    bridge,
    notebooks,
  };
}
afterEach(() => TestBed.resetTestingModule());
describe("Today sidebar navigation", () => {
  it("flushes the current daily document before routing to a dated file", async () => {
    const daily = { flush: vi.fn().mockResolvedValue(true) };
    const router = { navigateByUrl: vi.fn().mockResolvedValue(true) };
    await AppComponent.prototype.openDay.call(
      { daily, router, navigationIntent: 0 } as any,
      "2026-10-01",
    );
    expect(daily.flush).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith("/today/2026-10-01");
  });
  it("keeps a conflicting draft open", async () => {
    const daily = { flush: vi.fn().mockResolvedValue(false) };
    const router = { navigateByUrl: vi.fn() };
    await AppComponent.prototype.openDay.call(
      { daily, router, navigationIntent: 0 } as any,
      "2026-10-01",
    );
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
  it("ignores a delayed day click after the user selects Sources", async () => {
    let finish!: (value: boolean) => void;
    const { component, router } = shell(
      vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve))),
    );
    const opening = component.openDay("2026-10-01");
    component.navigate("sources");
    await vi.waitFor(() => expect(router.url).toBe("/sources"));
    finish(true);
    await opening;
    expect(router.url).toBe("/sources");
  });
  it("ignores delayed notebook selection after another route starts", async () => {
    let finish!: () => void;
    const { component, router, notebooks } = shell();
    notebooks.selectBook.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const opening = component.openNotebook("book");
    await vi.waitFor(() => expect(notebooks.selectBook).toHaveBeenCalled());
    await router.navigateByUrl("/sources");
    finish();
    await opening;
    expect(router.url).toBe("/sources");
  });
  it("keeps Sources mounted through repeated loaded snapshots", async () => {
    const { fixture, router, bridge } = shell();
    await router.navigateByUrl("/sources");
    fixture.detectChanges();
    const navigations: NavigationStart[] = [];
    router.events.subscribe((event) => {
      if (event instanceof NavigationStart) navigations.push(event);
    });
    for (let i = 0; i < 3; i++) {
      bridge.state.set({ ...bridge.state(), busy: !!(i % 2), count: i });
      fixture.detectChanges();
    }
    expect(router.url).toBe("/sources");
    expect(navigations).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain("Sources remains open");
  });
  it("shows a retryable startup error instead of an endless loading message", () => {
    const { fixture, bridge } = shell();
    bridge.state.set({
      ...bridge.state(),
      loaded: false,
      startupError: "The local store could not open.",
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      "Unable to open your workspace",
    );
    expect(fixture.nativeElement.textContent).toContain(
      "The local store could not open.",
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      "Opening your workspace…",
    );
    const button = Array.from(
      fixture.nativeElement.querySelectorAll(
        "button",
      ) as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.trim() === "Try again")!;
    button.click();
    expect(bridge.act).toHaveBeenCalledWith({ action: "retryStartup" });
  });
});
