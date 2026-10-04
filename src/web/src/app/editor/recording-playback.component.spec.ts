import { TestBed } from "@angular/core/testing";
import { afterEach, expect, it, vi } from "vitest";
import { RecordingPlaybackComponent } from "./recording-playback.component";
import { AttachmentService } from "./attachment.service";

const ref = "Attachments/" + "a".repeat(64) + ".wav";
function setup(read = vi.fn().mockResolvedValue({ status: "ready", dataURL: "data:audio/wav;base64,UklGRg==" })) {
  const importFile = vi.fn().mockResolvedValue({ ref });
  TestBed.configureTestingModule({ providers: [{ provide: AttachmentService, useValue: { read, importFile } }] });
  const fixture = TestBed.createComponent(RecordingPlaybackComponent);
  fixture.componentRef.setInput("documentID", "doc");
  fixture.componentRef.setInput("eventID", "recording");
  return { fixture, component: fixture.componentInstance, read, importFile };
}
afterEach(() => TestBed.resetTestingModule());

it("plays only an authorized notebook audio reference with controls and no autoplay", async () => {
  const { fixture, component, read } = setup();
  fixture.componentRef.setInput("attachmentID", ref);
  fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  expect(read).toHaveBeenCalledWith("doc", ref);
  const audio = fixture.nativeElement.querySelector("audio");
  expect(audio.controls).toBe(true);
  expect(audio.autoplay).toBe(false);
  expect(audio.getAttribute("src")).toBe("data:audio/wav;base64,UklGRg==");
  Object.defineProperty(audio, "duration", { value: 42 });
  audio.dispatchEvent(new Event("loadedmetadata")); fixture.detectChanges();
  expect(component.duration()).toBe("0:42");
});

it("rejects remote/absolute references without reading and does not offer mutation in read-only mode", async () => {
  const { fixture, read } = setup();
  fixture.componentRef.setInput("attachmentID", "https://example.invalid/private.wav");
  fixture.componentRef.setInput("readOnly", true);
  fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  expect(read).not.toHaveBeenCalled();
  expect(fixture.nativeElement.querySelector("audio")).toBeNull();
  expect(fixture.nativeElement.querySelector("input")).toBeNull();
  expect(fixture.nativeElement.textContent).toContain("unsupported audio reference");
});

it("exposes missing media with retry and rejects a non-audio response", async () => {
  const read = vi.fn().mockResolvedValueOnce({ status: "missing" }).mockResolvedValueOnce({ status: "ready", dataURL: "data:text/html;base64,YQ==" });
  const { fixture, component } = setup(read);
  fixture.componentRef.setInput("attachmentID", ref);
  fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain("Audio is missing");
  await component.load(); fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain("not supported audio");
  expect(fixture.nativeElement.querySelector("audio")).toBeNull();
});

it("ignores an old document's audio response after rebinding", async () => {
  let finish!: (value: any) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise(resolve => finish = resolve)).mockResolvedValue({ status: "missing" });
  const { fixture, component } = setup(read);
  fixture.componentRef.setInput("attachmentID", ref);
  fixture.detectChanges(); await vi.waitFor(() => expect(finish).toBeDefined());
  fixture.componentRef.setInput("documentID", "next"); fixture.detectChanges(); await fixture.whenStable();
  finish({ status: "ready", dataURL: "data:audio/wav;base64,UklGRg==" });
  await Promise.resolve();
  expect(component.audioURL()).toBe("");
});

it("attaches an existing file without changing evidence and rejects late imports after read-only transition", async () => {
  const { fixture, component, importFile } = setup();
  fixture.detectChanges(); await fixture.whenStable();
  const attached = vi.fn(); component.attached.subscribe(attached);
  const file = new File(["synthetic audio"], "fixture.wav", { type: "audio/x-wav" });
  const event = { target: { files: [file], value: "file" } } as unknown as Event;
  await component.attach(event);
  expect(importFile).toHaveBeenCalledWith("doc", expect.any(File));
  expect(importFile.mock.calls[0][1].type).toBe("audio/wav");
  expect(attached).toHaveBeenCalledWith({ eventID: "recording", previousAttachmentID: undefined, attachmentID: ref });
  let finish!: (value: any) => void;
  importFile.mockImplementationOnce(() => new Promise(resolve => finish = resolve));
  const importing = component.attach(event);
  fixture.componentRef.setInput("readOnly", true); fixture.detectChanges();
  finish({ ref }); await importing;
  expect(attached).toHaveBeenCalledTimes(1);
});
