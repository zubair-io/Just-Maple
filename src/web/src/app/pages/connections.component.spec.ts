import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionsComponent } from "./connections.component";
import { NativeBridge, emptySnapshot } from "../core/native-bridge.service";
afterEach(() => TestBed.resetTestingModule());
function setup() {
  const bridge = TestBed.inject(NativeBridge);
  bridge.state.set({
    ...emptySnapshot,
    loaded: true,
    classificationProvider: "laya",
    classificationState: "validation_required",
    classificationStatus:
      "Experimental Laya loaded. This model has not passed quality validation; automatic processing is disabled and queued events are retained.",
    classificationCanRun: false,
  });
  const act = vi.spyOn(bridge, "act").mockResolvedValue(true);
  const fixture = TestBed.createComponent(ConnectionsComponent);
  fixture.componentRef.setInput("scope", "intelligence");
  fixture.detectChanges();
  return { fixture, bridge, act };
}
describe("Local classification settings", () => {
  it("shows the experimental local candidate and visible gate while retaining separate extraction choices", () => {
    const { fixture } = setup(),
      text = fixture.nativeElement.textContent;
    expect(text).toContain("Laya · experimental local classification");
    expect(text).toContain("has not passed quality validation");
    expect(text).toContain(
      "Local Laya classification does not change your extraction provider",
    );
    expect(text).toContain("source text is sent to this provider");
    expect(text).not.toContain("Jev still classifies");
  });
  it("only changes classification providers after an explicit action", () => {
    const { fixture, act } = setup();
    expect(act).not.toHaveBeenCalled();
    fixture.componentInstance.classification("laya");
    expect(act).toHaveBeenLastCalledWith({
      action: "classificationSelect",
      provider: "laya",
    });
    fixture.componentInstance.classification("jev");
    expect(act).toHaveBeenLastCalledWith({
      action: "classificationSelect",
      provider: "jev",
    });
  });
  it("keeps load failure visible without substituting a remote provider", () => {
    const { fixture, bridge, act } = setup();
    bridge.state.update((value) => ({
      ...value,
      classificationState: "load_failed",
      classificationStatus: "Laya could not load. Queued events are retained.",
    }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      "Laya could not load. Queued events are retained.",
    );
    expect(fixture.nativeElement.textContent).toContain(
      "An explicit Laya selection never falls back to Jev automatically",
    );
    expect(act).not.toHaveBeenCalled();
    expect(bridge.state().classificationProvider).toBe("laya");
  });
});
