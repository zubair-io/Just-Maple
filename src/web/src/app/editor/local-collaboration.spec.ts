import { ComponentFixture, TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapleEditorComponent } from "./maple-editor.component";
import { decodeDaily } from "./daily-markdown-codec";
import { AutomaticProposal, ProposedBlock } from "./local-collaboration";

let fixture: ComponentFixture<MapleEditorComponent> | undefined;
function block(id: string, body: string): ProposedBlock {
  return { blockID: id, markdown: `<!-- maple:block ${JSON.stringify({ v: 1, id })} -->\n${body}\n` };
}
function mount(raw = block("writing", "My writing").markdown) {
  fixture = TestBed.createComponent(MapleEditorComponent);
  fixture.componentRef.setInput("initial", raw);
  fixture.componentRef.setInput("documentID", "today-doc");
  fixture.detectChanges();
  return fixture.componentInstance;
}
function proposal(blocks = [block("arrival", "A new FYI")]): AutomaticProposal {
  return { documentID: "today-doc", removals: [], groups: [
    { headingID: "fyi", title: "FYI", createHeading: true, blocks },
  ] };
}
afterEach(() => {
  fixture?.destroy();
  fixture = undefined;
  TestBed.resetTestingModule();
});

describe("Local user and Maple collaboration", () => {
  it("defers arrivals and replies without receipts during composition, then replays once against committed writing", () => {
    const component = mount(block("request", "@maple Find sources").markdown + "\n" + block("writing", "東京").markdown);
    const editor = component.editor!, changed = vi.fn();
    component.changed.subscribe(changed);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const before = editor.getJSON(), selection = editor.state.selection.toJSON();
    const composing = vi.spyOn(editor.view, "composing", "get").mockReturnValue(true);
    const arrival = proposal([block("auto-source:" + "a".repeat(64), "New source")]);
    const reply = { runID: "run", documentID: "today-doc", requestBlockID: "request", requestText: "Find sources", blocks: [block("reply", "Found a source")] };
    expect(component.applyAutomaticProposal(arrival)).toBe(false);
    expect(component.applyMapleResponse(reply)).toBe(false);
    expect(editor.getJSON()).toEqual(before);
    expect(editor.state.selection.toJSON()).toEqual(selection);
    expect(component.getAcceptedAutomaticBlockIDs()).toEqual([]);
    expect(component.getAcceptedReplyRunIDs()).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
    composing.mockReturnValue(false);
    editor.commands.insertContent("の予定");
    expect(component.applyAutomaticProposal(arrival)).toBe(true);
    expect(component.applyMapleResponse(reply)).toBe(true);
    expect(component.applyAutomaticProposal(arrival)).toBe(true);
    expect(component.applyMapleResponse(reply)).toBe(true);
    expect(component.editor).toBe(editor);
    expect(editor.state.selection.$from.parent.textContent).toBe("東京の予定");
    expect(editor.state.selection.$from.parentOffset).toBe(5);
    expect(editor.getJSON().content?.filter(node => node.attrs?.["maple"]?.id === "reply")).toHaveLength(1);
    expect(component.getAcceptedReplyRunIDs()).toEqual(["run"]);
    expect(component.getAcceptedAutomaticBlockIDs()).toEqual(["auto-source:" + "a".repeat(64)]);
    editor.commands.undo();
    expect(editor.state.doc.textContent).toContain("東京");
    expect(editor.state.doc.textContent).not.toContain("の予定");
    expect(editor.state.doc.textContent).toContain("New source");
    expect(editor.state.doc.textContent).toContain("Found a source");
  });
  it("rejects a deferred reply after composition changes the request", () => {
    const component = mount(block("request", "@maple Find sources").markdown), editor = component.editor!;
    const reply = { runID: "run", documentID: "today-doc", requestBlockID: "request", requestText: "Find sources", blocks: [block("reply", "Stale answer")] };
    const composing = vi.spyOn(editor.view, "composing", "get").mockReturnValue(true);
    expect(component.applyMapleResponse(reply)).toBe(false);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(" in 東京");
    composing.mockReturnValue(false);
    expect(component.applyMapleResponse(reply)).toBe(false);
    expect(component.getAcceptedReplyRunIDs()).toEqual([]);
    expect(editor.state.doc.textContent).not.toContain("Stale answer");
  });
  it("can redo typing in a new paragraph after toolbar undo", () => {
    const component = mount(), editor = component.editor!;
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.splitBlock();
    editor.commands.insertContent("New paragraph checkpoint");
    fixture!.detectChanges();
    fixture!.nativeElement.querySelector('[aria-label="Undo"]').click();
    fixture!.detectChanges();
    expect(editor.state.doc.textContent).not.toContain("New paragraph checkpoint");
    fixture!.nativeElement.querySelector('[aria-label="Redo"]').click();
    expect(editor.state.doc.textContent).toContain("New paragraph checkpoint");
  });
  it("seeds Markdown once and merges Maple blocks while typing without moving the cursor", () => {
    const component = mount(), editor = component.editor!;
    expect(editor.state.doc.textContent).toBe("My writing");
    expect(component.canUndo()).toBe(false);
    editor.commands.setTextSelection(4);
    editor.view.dispatch(editor.state.tr.insertText("new "));
    const caret = editor.state.selection.from;
    expect(component.applyAutomaticProposal(proposal())).toBe(true);
    expect(component.editor).toBe(editor);
    expect(editor.state.selection.from).toBe(caret);
    expect(editor.state.doc.textContent).toBe("My new writingFYIA new FYI");
    expect(component.applyAutomaticProposal(proposal())).toBe(true);
    expect(editor.state.doc.childCount).toBe(3);
    editor.commands.undo();
    expect(editor.state.doc.textContent).toBe("My writingFYIA new FYI");
    editor.commands.redo();
    expect(editor.state.doc.textContent).toBe("My new writingFYIA new FYI");
    const decoded = decodeDaily(component.raw);
    expect(decoded.sourceOnly).toBe(false);
    expect(decoded.doc.content?.map(node => (node.attrs?.["maple"] as any)?.id))
      .toEqual(["writing", "fyi", "arrival"]);
  });

  it("maps the caret through an insertion earlier in the note", () => {
    const component = mount(block("fyi", "## FYI").markdown + "\n" +
      block("personal", "## Personal").markdown + "\n" + block("writing", "My writing").markdown);
    const editor = component.editor!;
    editor.commands.setTextSelection(editor.state.doc.content.size - 3);
    const offset = editor.state.selection.$from.parentOffset;
    component.applyAutomaticProposal(proposal());
    expect(editor.state.selection.$from.parent.attrs["maple"].id).toBe("writing");
    expect(editor.state.selection.$from.parentOffset).toBe(offset);
    expect(editor.state.doc.child(1).attrs["maple"].id).toBe("arrival");
  });

  it("keeps a locally deleted block deleted across repeated proposals before saving", () => {
    const component = mount(), editor = component.editor!;
    component.applyAutomaticProposal(proposal());
    const last = editor.state.doc.lastChild!;
    editor.view.dispatch(editor.state.tr.delete(editor.state.doc.content.size - last.nodeSize, editor.state.doc.content.size));
    component.applyAutomaticProposal(proposal());
    expect(editor.state.doc.textContent).toBe("My writingFYI");
    expect(component.raw).not.toContain("arrival");
  });

  it("removes only an unchanged misplaced calendar block and preserves user changes", () => {
    const old = block("future-event", "Old calendar title");
    const component = mount(old.markdown), editor = component.editor!;
    editor.commands.setTextSelection(2);
    editor.view.dispatch(editor.state.tr.insertText("my correction "));
    component.applyAutomaticProposal({ documentID: "today-doc", groups: [], removals: [old] });
    expect(editor.state.doc.textContent).toContain("my correction");
    editor.commands.undo();
    component.applyAutomaticProposal({ documentID: "today-doc", groups: [], removals: [old] });
    expect(editor.state.doc.textContent).not.toContain("Old calendar title");
  });

  it("inserts email, message, HA and calendar references with their evidence identities", () => {
    const component = mount();
    const references = ["email", "message", "ha", "calendar"].map(kind => block(`ref-${kind}`,
      '```maple-ref\n' + JSON.stringify({ v: 1, kind, eventID: `fixture:${kind}`, label: `Fixture ${kind}` }) + '\n```'));
    component.applyAutomaticProposal(proposal(references));
    const decoded = decodeDaily(component.raw);
    expect(decoded.sourceOnly).toBe(false);
    expect(decoded.doc.content?.filter(node => node.type === "sourceReference").map(node =>
      (node.attrs?.["reference"] as any)?.eventID)).toEqual(references.map((_, i) =>
      `fixture:${["email", "message", "ha", "calendar"][i]}`));
  });

  it("does not duplicate a source the user inserted before autosave", () => {
    const source = '```maple-ref\n' + JSON.stringify({ v: 1, kind: "email", eventID: "fixture:email" }) + '\n```';
    const component = mount(block("manual-reference", source).markdown);
    component.applyAutomaticProposal(proposal([block("automatic-reference", source)]));
    expect(component.editor!.getJSON().content?.filter(node => node.type === "sourceReference")).toHaveLength(1);
    expect(component.raw).not.toContain("automatic-reference");
    expect(component.editor!.state.doc.child(0).attrs["maple"].id).toBe("manual-reference");
  });

  it("inserts a reply inline while protecting a request edited after submission", () => {
    const component = mount(block("request", "@maple Find my emails").markdown + "\n" + block("writing", "Keep typing").markdown);
    const reply = { runID: "run", documentID: "today-doc", requestBlockID: "request", requestText: "Find my emails", blocks: [block("reply", "Found two emails")] };
    const editor = component.editor!;
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.dispatch(editor.state.tr.insertText(" now"));
    expect(component.applyMapleResponse(reply)).toBe(true);
    expect(editor.state.doc.child(1).textContent).toBe("Found two emails");
    expect(editor.state.selection.$from.parent.textContent).toBe("Keep typing now");
    editor.commands.undo();
    expect(editor.state.doc.child(1).textContent).toBe("Found two emails");
    expect(editor.state.doc.lastChild!.textContent).toBe("Keep typing");
    editor.commands.setTextSelection(8);
    editor.view.dispatch(editor.state.tr.insertText("different "));
    expect(component.applyMapleResponse({ ...reply, runID: "run-2", blocks: [block("reply-2", "Stale response")] })).toBe(false);
    expect(editor.state.doc.textContent).not.toContain("Stale response");
  });

  it("decodes native multiline reply paragraphs and does not resurrect a deleted reply", () => {
    const component = mount(block("request", "@maple Find sources").markdown);
    const reply = { runID: "run", documentID: "today-doc", requestBlockID: "request", requestText: "Find sources", blocks: [
      block("reply", "&#32;&#32;&#32;&#32;Indented literal &amp;amp; text.  \nSecond line."),
      block("reply-paragraph-1", "Coverage: captured sources only."),
    ] };
    expect(component.applyMapleResponse(reply)).toBe(true);
    const editor = component.editor!;
    expect(editor.state.doc.child(1).type.name).toBe("paragraph");
    expect(editor.state.doc.child(1).textContent).toContain("Indented literal &amp; text.");
    expect(editor.state.doc.childCount).toBe(3);
    const pos = editor.state.doc.child(0).nodeSize;
    editor.view.dispatch(editor.state.tr.delete(pos, pos + editor.state.doc.child(1).nodeSize));
    expect(component.applyMapleResponse({ ...reply, blocks: [...reply.blocks, block("new-citation", "New citation")] })).toBe(true);
    expect(editor.state.doc.textContent).not.toContain("New citation");
    expect(component.getAcceptedReplyRunIDs()).toEqual(["run"]);
  });

  it("restores accepted automatic receipts after recovery even without their deleted prose", () => {
    const id = "auto-source:" + "a".repeat(64);
    const component = mount();
    component.restoreAutomaticBlockIDs([id]);
    component.applyAutomaticProposal(proposal([block(id, "Already deleted")]));
    expect(component.editor!.state.doc.textContent).toBe("My writing");
    expect(component.getAcceptedAutomaticBlockIDs()).toContain(id);
  });
  it("keeps a reply deleted across recovery before its acknowledgement is saved", () => {
    const component = mount(block("request", "@maple Find sources").markdown);
    component.restoreReplyRunIDs(["run"]);
    expect(component.applyMapleResponse({ runID: "run", documentID: "today-doc", requestBlockID: "request", requestText: "Find sources", blocks: [block("reply", "Deleted reply")] })).toBe(true);
    expect(component.editor!.state.doc.childCount).toBe(1);
  });

  it("defers in Markdown mode and rejects another document or malformed blocks", () => {
    const component = mount();
    expect(component.applyAutomaticProposal({ ...proposal(), documentID: "other" })).toBe(false);
    expect(() => component.applyAutomaticProposal(proposal([block("valid", "Valid"), { blockID: "invalid", markdown: "No identity" }]))).toThrow();
    expect(component.editor!.state.doc.textContent).toBe("My writing");
    component.toggleSource();
    expect(component.applyAutomaticProposal(proposal())).toBe(false);
    component.sourceChanged(block("writing", "Changed in Markdown").markdown);
    component.toggleSource();
    expect(component.applyAutomaticProposal(proposal())).toBe(true);
    expect(component.editor!.state.doc.textContent).toContain("Changed in Markdown");
  });
});
