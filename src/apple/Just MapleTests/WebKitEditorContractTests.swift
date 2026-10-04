import AppKit
import Foundation
import Testing
import WebKit
import MapleCore
import MapleNotebooks
@testable import Just_Maple

private final class IsolatedEditorContractWindow:NSWindow {
    override var canBecomeKey:Bool {true}
}

/// Uses an isolated real WKWebView. Does not enable VoiceOver, switch OS IMEs, order a window
/// front, activate the app, or claim programmatic NSTextInputClient calls exercise a physical IME.
@MainActor
@Suite(.serialized)
struct WebKitEditorContractTests {
    private func eventually(_ web:WKWebView,_ script:String)async throws {
        for _ in 0..<100 {
            if (try? await web.evaluateJavaScript(script)) as? Bool == true {return}
            try await Task.sleep(for:.milliseconds(50))
        }
        throw MapleError.invalid("Isolated WebKit condition timed out: "+script)
    }
    private func attachSnapshot(_ web:WKWebView,named name:String)async throws {
        let image=try await web.takeSnapshot(configuration:nil)
        let tiff=try #require(image.tiffRepresentation)
        let bitmap=try #require(NSBitmapImageRep(data:tiff))
        let png=try #require(bitmap.representation(using:.png,properties:[:]))
        Attachment.record(Array(png),named:name)
    }
    private func markdownBlockIDs(_ content:String)throws->[String] {
        try content.split(separator:"\n").compactMap {line in
            let prefix="<!-- maple:block ",suffix=" -->"
            guard line.hasPrefix(prefix),line.hasSuffix(suffix) else{return nil}
            let json=line.dropFirst(prefix.count).dropLast(suffix.count)
            return (try JSONSerialization.jsonObject(with:Data(json.utf8)) as? [String:Any])?["id"] as? String
        }
    }
    private func textClients(_ view:NSView)->[any NSTextInputClient] {
        if let client=view as? any NSTextInputClient {return [client]}
        return view.subviews.flatMap{textClients($0)}
    }

    @Test func nativeMarkedTextSavesExactlyOnceAndWebKitHeadingSemanticsStayAccessible()async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent("maple-webkit-contract-"+UUID().uuidString)
        let defaultsName="maple.synthetic.webkit."+UUID().uuidString
        let defaults=try #require(UserDefaults(suiteName:defaultsName))
        defer {try? FileManager.default.removeItem(at:root);defaults.removePersistentDomain(forName:defaultsName)}
        try FileManager.default.createDirectory(at:root.appendingPathComponent("Cloud"),withIntermediateDirectories:true)
        let library=try NotebookLibrary(registryURL:root.appendingPathComponent("registry.json"),cloudRoot:root.appendingPathComponent("Cloud"))
        let store=try KnowledgeStore(path:root.appendingPathComponent("core.sqlite").path)
        let model=AppModel(directory:root,classificationDefaults:defaults)
        model.notebooks=library;model.store=store;model.loaded=true;model.ready=true;model.name="Synthetic WebKit contract"
        let bridge=Bridge(model:model);bridge.step = -1
        let coordinator=try await bridge.todayCoordinator(),notebook=try await library.ensureJustMapleDailyNotebook()
        let initial=try await coordinator.open(notebookID:notebook)
        let content=initial.content+(try ManagedMarkdown.marker(["id":"webkit-heading"]))+"## Synthetic fold section\n\n"+(try ManagedMarkdown.marker(["id":"webkit-writing"]))+"Synthetic writing.\n"
        _ = try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:content,commandID:"synthetic-webkit-seed")
        let web=WebShell.makeWebView(bridge:bridge)
        let window=IsolatedEditorContractWindow(contentRect:NSRect(x:0,y:0,width:1200,height:900),styleMask:[.borderless],backing:.buffered,defer:false)
        window.isReleasedWhenClosed=false;window.contentView=web;window.makeKey()
        defer {web.stopLoading();web.configuration.userContentController.removeScriptMessageHandler(forName:"maple",contentWorld:.page);window.contentView=nil;window.close()}
        // Make only this test-host window key; never order it front or activate the app.
        try await eventually(web,"!!Array.from(document.querySelectorAll('.canvas-view-switch button')).find(b=>b.textContent.trim()==='Note')")
        // Programmatic WebKit gesture contract, not a physical trackpad-quality claim.
        let beforeCamera = try await library.read(notebookID:notebook,path:initial.path)
        _ = try await web.evaluateJavaScript("""
        const viewport=document.querySelector('.maple-canvas-viewport');
        viewport.dispatchEvent(new Event('gesturestart',{bubbles:true,cancelable:true}));
        const pinch=new Event('gesturechange',{bubbles:true,cancelable:true});
        Object.defineProperties(pinch,{scale:{value:1.2},clientX:{value:400},clientY:{value:300}});
        viewport.dispatchEvent(pinch);true
        """)
        try await eventually(web,"document.querySelector('[aria-label=\"Reset canvas zoom\"]')?.textContent.trim()==='120%'")
        #expect(try await library.read(notebookID:notebook,path:initial.path).content == beforeCamera.content)
        _ = try await web.evaluateJavaScript("Array.from(document.querySelectorAll('.canvas-view-switch button')).find(b=>b.textContent.trim()==='Note').click()")
        try await eventually(web,"!!document.querySelector('.tiptap .maple-section-toggle')")
        #expect(!window.isVisible)
        let originalJSON=try await web.evaluateJavaScript("JSON.stringify(document.querySelector('.tiptap').editor.getJSON())") as? String
        // DOM/renderer accessibility semantics only: the hidden host exposes a remote AX proxy,
        // not its cross-process tree. VoiceOver/native AX traversal remains a separate manual gate.
        #expect(try await web.evaluateJavaScript("document.querySelector('.tiptap').getAttribute('role') === 'textbox' && document.querySelector('.tiptap').getAttribute('aria-label') === 'Daily note editor'") as? Bool == true)
        #expect(try await web.evaluateJavaScript("document.querySelector('.maple-section-toggle').getAttribute('aria-label') === 'Collapse section: Synthetic fold section' && document.querySelector('.maple-section-toggle').getAttribute('aria-expanded') === 'true'") as? Bool == true)
        _ = try await web.evaluateJavaScript("document.querySelector('.maple-section-toggle').click()")
        try await eventually(web,"document.querySelector('.maple-section-toggle').getAttribute('aria-expanded') === 'false'")
        #expect(try await web.evaluateJavaScript("document.querySelector('.maple-section-toggle').getAttribute('aria-label') === 'Expand section: Synthetic fold section'") as? Bool == true)
        #expect(try await web.evaluateJavaScript("document.querySelector('.maple-section-hidden').getAttribute('aria-hidden') === 'true' && getComputedStyle(document.querySelector('.maple-section-hidden')).display === 'none'") as? Bool == true)
        #expect(try await web.evaluateJavaScript("JSON.stringify(document.querySelector('.tiptap').editor.getJSON())") as? String == originalJSON)
        _ = try await web.evaluateJavaScript("document.querySelector('.maple-section-toggle').click();document.querySelector('.tiptap').editor.commands.setTextSelection(document.querySelector('.tiptap').editor.state.doc.content.size-1);document.querySelector('.tiptap').focus();window.syntheticCompositionEvents=[];for(const type of ['compositionstart','compositionupdate','compositionend','beforeinput','input'])document.querySelector('.tiptap').addEventListener(type,e=>window.syntheticCompositionEvents.push({type:e.type,data:e.data,inputType:e.inputType,isComposing:e.isComposing,isTrusted:e.isTrusted}));true")
        let clients=textClients(web)
        let client=try #require(clients.first)
        if let responder=client as? NSResponder {_ = window.makeFirstResponder(responder)}
        try await eventually(web,"document.activeElement?.isContentEditable === true")
        client.setMarkedText("にほん",selectedRange:NSRange(location:3,length:0),replacementRange:NSRange(location:NSNotFound,length:0))
        try await eventually(web,"window.syntheticCompositionEvents.some(e=>e.type==='compositionstart')")
        try await eventually(web,"document.querySelector('.tiptap').editor.view.composing")
        client.insertText("日本語",replacementRange:NSRange(location:NSNotFound,length:0))
        try await eventually(web,"window.syntheticCompositionEvents.some(e=>e.type==='compositionend') && !document.querySelector('.tiptap').editor.view.composing")
        try await eventually(web,"document.querySelector('.tiptap').textContent.includes('日本語')")
        let events=try await web.evaluateJavaScript("JSON.stringify(window.syntheticCompositionEvents)") as? String
        print("SYNTHETIC_WEBKIT_NATIVE_TEXT_INPUT="+(events ?? "missing"))
        #expect(try await web.evaluateJavaScript("window.syntheticCompositionEvents.filter(e=>e.type.startsWith('composition')).every(e=>e.isTrusted)") as? Bool == true)
        for _ in 0..<60 {
            if try await library.read(notebookID:notebook,path:initial.path).content.contains("日本語") {break}
            try await Task.sleep(for:.milliseconds(50))
        }
        let saved=try await library.read(notebookID:notebook,path:initial.path)
        #expect(saved.content.contains("日本語"))
        #expect(!saved.content.contains("にほん"))
        #expect(saved.content.components(separatedBy:"日本語").count==2)
        #expect(try await store.inlineMapleRuns(documentID:initial.documentID).isEmpty)
        #expect(!model.connected && !model.running)
        print("SYNTHETIC_WEBKIT_CONTRACT=passed; native NSTextInputClient trusted composition and Markdown persistence; WebKit heading DOM semantics; VoiceOver, remote AX tree and real OS IME not exercised")
        #expect(!window.isVisible)
    }

    @Test(.timeLimit(.minutes(1))) func nativeSourcePickerInspectorAndClearRestorePersistThroughRealBridgeAndReload()async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent("maple-webkit-sources-"+UUID().uuidString)
        let defaultsName="maple.synthetic.webkit.sources."+UUID().uuidString
        let defaults=try #require(UserDefaults(suiteName:defaultsName))
        defer {try? FileManager.default.removeItem(at:root);defaults.removePersistentDomain(forName:defaultsName)}
        try FileManager.default.createDirectory(at:root.appendingPathComponent("Cloud"),withIntermediateDirectories:true)
        let library=try NotebookLibrary(registryURL:root.appendingPathComponent("registry.json"),cloudRoot:root.appendingPathComponent("Cloud"))
        let store=try KnowledgeStore(path:root.appendingPathComponent("core.sqlite").path)
        let at=Date(),emailID="synthetic-native-email",messageID="synthetic-native-message",homeID="synthetic-native-home"
        let original="Sender: Synthetic Author <fixture@example.invalid>\nSubject: Synthetic native email\nBody:\nOriginal immutable synthetic email evidence, visible through the real inspector."
        let events=[
            Event(id:emailID,type:"mail.received",source:.init(connector:"gmail",account:"synthetic",externalID:emailID,revision:"1"),occurredAt:at,receivedAt:at,subjects:["person:self"],content:original),
            Event(id:messageID,type:"message.received",source:.init(connector:"imessage",account:"synthetic",externalID:messageID,revision:"1"),occurredAt:at,receivedAt:at,subjects:["person:self"],content:"Sender: Synthetic Friend\nSubject: Synthetic native message\nBody:\nSynthetic iMessage observation for native integration."),
            Event(id:homeID,type:"state.changed",source:.init(connector:"home_assistant",account:"synthetic",externalID:homeID,revision:"1"),occurredAt:at,receivedAt:at,subjects:["person:self"],content:"Home Assistant entity: binary_sensor.synthetic_door\nName: Synthetic native door\nState: open\nAttributes: {}")
        ]
        for event in events {_ = try await store.ingest(event)}
        let model=AppModel(directory:root,classificationDefaults:defaults)
        model.notebooks=library;model.store=store;model.loaded=true;model.ready=true;model.name="Synthetic native source integration"
        let bridge=Bridge(model:model);bridge.step = -1
        let coordinator=try await bridge.todayCoordinator(),notebook=try await library.ensureJustMapleDailyNotebook()
        let initial=try await coordinator.open(notebookID:notebook)
        let content=initial.content+(try ManagedMarkdown.marker(["id":"native-source-writing"]))+"Synthetic writing survives reference insertion and recovery.\n"
        _ = try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:content,commandID:"synthetic-source-seed")
        let web=WebShell.makeWebView(bridge:bridge)
        let window=IsolatedEditorContractWindow(contentRect:NSRect(x:0,y:0,width:1200,height:900),styleMask:[.borderless],backing:.buffered,defer:false)
        window.isReleasedWhenClosed=false;window.contentView=web;window.makeKey()
        defer {web.stopLoading();web.configuration.userContentController.removeScriptMessageHandler(forName:"maple",contentWorld:.page);window.contentView=nil;window.close()}
        try await eventually(web,"!!document.querySelector('.tiptap') && !!document.querySelector('[aria-label=\"Insert a block\"]')")
        // Position only; insertion, inspection and clear/restore all use the visible UI's event handlers.
        _ = try await web.evaluateJavaScript("document.querySelector('.tiptap').editor.commands.setTextSelection(document.querySelector('.tiptap').editor.state.doc.content.size-1);document.querySelector('.tiptap').focus();document.querySelector('button[aria-label=\"Insert a block\"]').click();true")
        try await eventually(web,"!!Array.from(document.querySelectorAll('.maple-toolbar-palette button')).find(b=>b.textContent.trim()==='Source reference')")
        _ = try await web.evaluateJavaScript("Array.from(document.querySelectorAll('.maple-toolbar-palette button')).find(b=>b.textContent.trim()==='Source reference').click()")
        try await eventually(web,"!!Array.from(document.querySelectorAll('.picker-row')).find(b=>b.textContent.includes('Synthetic native email'))")
        #expect(try await web.evaluateJavaScript("Array.from(document.querySelectorAll('.picker-row')).some(b=>b.textContent.includes('imessage')) && Array.from(document.querySelectorAll('.picker-row')).some(b=>b.textContent.includes('home_assistant'))") as? Bool == true)
        _ = try await web.evaluateJavaScript("Array.from(document.querySelectorAll('.picker-row')).find(b=>b.textContent.includes('Synthetic native email')).click()")
        try await eventually(web,"document.querySelector('.source-card-title')?.textContent === 'Synthetic native email' && !document.querySelector('.source-picker')")
        var backlinks=[ManagedSourceBacklink]()
        for _ in 0..<100 {
            backlinks=try await store.managedSourceBacklinks(eventID:emailID)
            if backlinks.count==1 {break}
            try await Task.sleep(for:.milliseconds(50))
        }
        let backlink=try #require(backlinks.first)
        #expect(backlinks.count==1 && backlink.documentID==initial.documentID && backlink.path==initial.path)
        let saved=try await library.read(notebookID:notebook,path:initial.path)
        #expect(saved.content.contains("```maple-ref") && saved.content.contains(emailID))
        #expect(try markdownBlockIDs(saved.content).filter{$0==backlink.blockID}.count==1)
        #expect(saved.content.contains("Synthetic writing survives reference insertion and recovery."))
        #expect(try await store.documentBlock(id:backlink.blockID)?.eventID==emailID)
        _ = try await web.evaluateJavaScript("document.querySelector('.source-card-title').click()")
        try await eventually(web,"document.querySelector('maple-source-detail #source-tab-Original pre')?.textContent?.includes('Original immutable synthetic email evidence') === true")
        #expect(try await web.evaluateJavaScript("document.querySelector('maple-source-detail #source-tab-Original pre').textContent") as? String == original)
        try await attachSnapshot(web,named:"synthetic-native-source-inspector.png")
        _ = try await web.evaluateJavaScript("Array.from(document.querySelectorAll('maple-source-detail button')).find(b=>b.textContent.trim()==='Close').click()")
        try await eventually(web,"!document.querySelector('maple-source-detail')")
        _ = try await web.evaluateJavaScript("(() => {const editor=document.querySelector('.tiptap').editor;let pos;editor.state.doc.descendants((node,p)=>{if(node.type.name==='sourceReference')pos=p});editor.commands.setNodeSelection(pos);document.querySelector('.tiptap').focus();document.querySelector('button[aria-label=\"Insert a block\"]').click();return true})()")
        try await eventually(web,"!!Array.from(document.querySelectorAll('.maple-toolbar-palette button')).find(b=>b.textContent.trim()==='Block actions')")
        _ = try await web.evaluateJavaScript("Array.from(document.querySelectorAll('.maple-toolbar-palette button')).find(b=>b.textContent.trim()==='Block actions').click()")
        try await eventually(web,"!!Array.from(document.querySelectorAll('.maple-block-actions button')).find(b=>b.textContent.trim()==='Clear from note')")
        _ = try await web.evaluateJavaScript("Array.from(document.querySelectorAll('.maple-block-actions button')).find(b=>b.textContent.trim()==='Clear from note').click()")
        try await eventually(web,"!document.querySelector('.source-card')")
        #expect(try await store.documentBlock(id:backlink.blockID)?.state=="cleared")
        #expect(try await store.managedSourceBacklinks(eventID:emailID).isEmpty)
        #expect(try await store.sourceDetail(eventID:emailID).content==original)
        #expect(try await library.read(notebookID:notebook,path:initial.path).content.contains(emailID)==false)
        _ = try await web.evaluateJavaScript("document.querySelector('button[aria-label=\"Document tools\"]').click()")
        try await eventually(web,"!!Array.from(document.querySelectorAll('.document-tools-drawer button')).find(b=>b.textContent.trim()==='Restore block')")
        _ = try await web.evaluateJavaScript("Array.from(document.querySelectorAll('.document-tools-drawer button')).find(b=>b.textContent.trim()==='Restore block').click()")
        try await eventually(web,"document.querySelector('.source-card-title')?.textContent === 'Synthetic native email'")
        #expect(try await store.documentBlock(id:backlink.blockID)?.state=="active")
        let restoredLinks=try await store.managedSourceBacklinks(eventID:emailID)
        #expect(restoredLinks.count==1 && restoredLinks.first?.blockID==backlink.blockID)
        let restored=try await library.read(notebookID:notebook,path:initial.path)
        #expect(try markdownBlockIDs(restored.content).filter{$0==backlink.blockID}.count==1)
        let history=try await store.documentOperationHistory(documentID:initial.documentID)
        #expect(history.contains{$0.input.kind=="clear" && $0.input.blockID==backlink.blockID && $0.state=="committed"})
        #expect(history.contains{$0.input.kind=="restore" && $0.input.blockID==backlink.blockID && $0.state=="committed"})
        _ = try await web.evaluateJavaScript("window.syntheticReloadToken=true")
        web.reload()
        try await eventually(web,"window.syntheticReloadToken === undefined && document.querySelector('.source-card-title')?.textContent === 'Synthetic native email' && document.querySelector('.tiptap')?.textContent?.includes('Synthetic writing survives reference insertion and recovery.') === true")
        #expect(try await web.evaluateJavaScript("document.querySelectorAll('.source-card').length") as? Int == 1)
        #expect(try await library.read(notebookID:notebook,path:initial.path).content==restored.content)
        let reopenedLinks=try await store.managedSourceBacklinks(eventID:emailID)
        #expect(reopenedLinks.count==1 && reopenedLinks.first?.blockID==backlink.blockID)
        try await eventually(web,"document.querySelector('.source-preview')?.textContent?.includes('Original immutable synthetic email evidence') === true")
        try await attachSnapshot(web,named:"synthetic-native-source-restored.png")
        Attachment.record(Array(restored.content.utf8),named:"synthetic-native-source-restored.md")
        Attachment.record(Array(try JSONCodec.encode(reopenedLinks)),named:"synthetic-native-source-backlinks.json")
        for event in events {
            let detail=try await store.sourceDetail(eventID:event.id)
            #expect(detail.content==event.content && detail.attempts.isEmpty)
        }
        #expect(!model.connected && !model.running && !window.isVisible)
        print("SYNTHETIC_WEBKIT_SOURCE_ROUNDTRIP=completed assertions; real ingest, native bridge, picker, inspector, Markdown reference, SQLite backlink, clear/restore history and reload; no provider calls or physical iCloud claim")
    }

}
