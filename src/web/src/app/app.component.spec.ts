import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { dailyRoutes, todayRedirect } from "./today/daily.routes";
import { Component, inject, signal, DestroyRef } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import {
  ActivatedRoute,
  NavigationStart,
  provideRouter,
  Router,
} from "@angular/router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppComponent } from "./app.component";
import { NativeBridge } from "./core/native-bridge.service";
import { TodayDocumentService } from "./today/today-document.service";
import { NotebookService } from "./notebooks/notebook.service";

@Component({ standalone: true, template: "Sources remains open" })
class SourcesStub {}
@Component({
  standalone: true,
  template:
    '<textarea aria-label="Test dated writing">Keep this draft</textarea>',
})
class DatedStub {
  readonly notes = inject(TodayDocumentService);
  constructor() {
    inject(ActivatedRoute)
      .paramMap.pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((params) => {

        void this.notes.open(params.get("date")!);
      });
  }
}
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
    catalog: signal<any>({ notebooks: [] }),
    bookID: signal(""),
    document: signal<any>(null),
    open: vi.fn(),
    refresh: vi.fn(),
    selectBook: vi.fn().mockResolvedValue(undefined),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: "sources", component: SourcesStub },
        { path: "processing", component: SourcesStub },
        { path: "notebooks", component: SourcesStub },
        { path: "", pathMatch: "full", redirectTo: todayRedirect },
        ...dailyRoutes.map((route) =>
          route.component ? { ...route, component: DatedStub } : route,
        ),
      ]),
      { provide: NativeBridge, useValue: bridge },
      {
        provide: TodayDocumentService,
        useValue: {
          flush,
          day: signal("1999-01-01"),
          open: vi.fn().mockResolvedValue(true),
        },
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
afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
});
describe("Today sidebar navigation", () => {
  it("opens a note from a collapsible notebook folder after preserving daily writing", async () => {
    const {fixture, component, router, notebooks} = shell();
    notebooks.catalog.set({notebooks:[{id:'book',name:'Ideas',notes:[{path:'idea.md',name:'A good idea'}]}]});
    notebooks.selectBook.mockImplementation(async (id: string) => { notebooks.bookID.set(id); });
    notebooks.open.mockImplementation(async (path: string) => { notebooks.document.set({notebookID:'book',path}); });
    await router.navigateByUrl('/today'); fixture.detectChanges();
    const folder=fixture.nativeElement.querySelector('.notebook-folder') as HTMLDetailsElement;
    expect(folder.open).toBe(false);
    expect(folder.querySelector('summary')?.textContent).toContain('Ideas');
    await component.openNotebook('book','idea.md'); fixture.detectChanges();
    expect(component.daily.flush).toHaveBeenCalled();
    expect(notebooks.open).toHaveBeenCalledWith('idea.md');
    expect(router.url).toBe('/notebooks');
    expect(folder.querySelector('[aria-current="page"]')?.textContent).toBe('A good idea');
  });
  it("keeps the current route when daily saving or notebook opening fails", async () => {
    const flush=vi.fn().mockResolvedValue(false);
    const {component, router, notebooks}=shell(flush);
    await router.navigateByUrl('/sources');
    await component.openNotebook('book','idea.md');
    expect(notebooks.selectBook).not.toHaveBeenCalled();
    expect(router.url).toBe('/sources');
    flush.mockResolvedValue(true);
    notebooks.selectBook.mockImplementation(async (id: string)=>{notebooks.bookID.set(id);});
    await component.openNotebook('book','idea.md');
    expect(notebooks.open).toHaveBeenCalledWith('idea.md');
    expect(router.url).toBe('/sources');
  });

  it("exposes Processing directly in the sidebar with route-based active styling", async () => {
    const { fixture, router } = shell();
    await router.navigateByUrl("/sources");
    fixture.detectChanges();
    const link = fixture.nativeElement.querySelector(".processing-link") as HTMLAnchorElement;
    expect(link.textContent?.trim()).toBe("Processing");
    expect(link.getAttribute("href")).toBe("/processing");
    expect(link.closest("details")).toBeNull();
    link.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(router.url).toBe("/processing");
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("renders stable relative links and derives active styling from the dated URL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 27, 12));
    const { fixture, component, router } = shell();
    await router.navigateByUrl("/today");
    fixture.detectChanges();
    expect(router.url).toBe("/daily/2026-09-27");
    expect(
      Array.from(
        fixture.nativeElement.querySelectorAll(
          ".day-rail a",
        ) as NodeListOf<HTMLAnchorElement>,
      ).map((a) => a.getAttribute("href")),
    ).toEqual(["/yesterday", "/today", "/tomorrow"]);
    // The mocked note date remains unrelated to the route; active styling must
    // derive from the resolved URL, not mutable editor state.
    expect(component.daily.day()).toBe("1999-01-01");
    fixture.detectChanges();
    expect(
      fixture.nativeElement
        .querySelector('.day-rail [aria-current="page"]')
        ?.textContent.trim(),
    ).toBe("Today");
  });
  it("changes only the highlight at midnight and resolves Today again when clicked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 27, 23, 59, 59));
    const { fixture, component, router } = shell();
    await router.navigateByUrl("/today");
    fixture.detectChanges();
    const field = fixture.nativeElement.querySelector(
      "textarea",
    ) as HTMLTextAreaElement;
    field.value = "Unsaved dated writing";
    field.focus();
    field.setSelectionRange(4, 4);
    vi.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(router.url).toBe("/daily/2026-09-27");
    expect(fixture.nativeElement.querySelector("textarea")).toBe(field);
    expect(field.value).toBe("Unsaved dated writing");
    expect(field.selectionStart).toBe(4);
    expect(component.daily.open).toHaveBeenCalledTimes(1);
    expect(
      fixture.nativeElement
        .querySelector('.day-rail [aria-current="page"]')
        ?.textContent.trim(),
    ).toBe("Yesterday");
    await router.navigateByUrl("/today");
    fixture.detectChanges();
    expect(router.url).toBe("/daily/2026-09-28");
    expect(component.daily.open).toHaveBeenLastCalledWith("2026-09-28");
    await router.navigateByUrl("/today");
    fixture.detectChanges();
    expect(component.daily.open).toHaveBeenCalledTimes(2);
  });
  it("redirects relative, legacy and invalid day links to canonical dated routes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2027, 0, 1, 12));
    const { router } = shell();
    for (const [path, target] of [
      ["/", "2027-01-01"],
      ["/daily", "2027-01-01"],
      ["/yesterday", "2026-12-31"],
      ["/tomorrow", "2027-01-02"],
      ["/today/2026-10-03", "2026-10-03"],
      ["/daily/2026-02-30", "2027-01-01"],
    ]) {
      await router.navigateByUrl(path);
      expect(router.url).toBe("/daily/" + target);
    }
  });
  it("keeps the dated URL and draft when the navigation save guard fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 27, 12));
    const flush = vi.fn().mockResolvedValue(false),
      { router, component } = shell(flush);
    await router.navigateByUrl("/today");
    expect(await router.navigateByUrl("/tomorrow")).toBe(false);
    expect(flush).toHaveBeenCalledOnce();
    expect(router.url).toBe("/daily/2026-09-27");
    expect(component.daily.open).toHaveBeenCalledOnce();
  });
  it("does not allow a delayed day navigation to override a newer Sources navigation", async () => {
    let finish!: (value: boolean) => void;
    const flush = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<boolean>((resolve) => (finish = resolve)),
      )
      .mockResolvedValue(true);
    const { router } = shell(flush);
    await router.navigateByUrl("/daily/2026-09-27");
    const opening = router.navigateByUrl("/tomorrow");
    await vi.waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
    await router.navigateByUrl("/sources");
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
