import AppKit
import MapleCore
import MapleNotebooks

extension Bridge {
    func notebookLibrary() async throws -> NotebookLibrary {
        if let library=model.notebooks {return library}
        let root=await Task.detached(priority:.utility) {
            FileManager.default.url(forUbiquityContainerIdentifier:"iCloud.com.just.maple.JapaneseMaple")?.appendingPathComponent("Documents",isDirectory:true)
        }.value
        if let root {try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)}
        // Re-check after the asynchronous iCloud lookup to avoid two independent registries.
        if let library=model.notebooks {return library}
        let library=try NotebookLibrary(registryURL:model.directory.appendingPathComponent("notebooks.json"),cloudRoot:root)
        model.notebooks=library
        _ = try await library.catalog()
        return library
    }
    func notebookCommand(_ action:String,_ body:[String:Any]) async throws -> Any {
        let library=try await notebookLibrary()
        switch action {
        case "notebookCatalog":return try json(try await library.catalog())
        case "notebookConnect":
            let panel=NSOpenPanel();panel.canChooseDirectories=true;panel.canChooseFiles=false;panel.allowsMultipleSelection=false;panel.prompt="Connect notebook";panel.message="Markdown files stay in the folder you choose."
            guard await panel.begin() == .OK,let url=panel.url else {return try json(try await library.catalog())}
            return try json(try await library.connect(url))
        case "notebookDisconnect":return try json(try await library.disconnect(string(body,"id",limit:256)))
        case "notebookCreate":return try json(try await library.createNotebook(name:string(body,"name",limit:180)))
        case "noteDraft":
            let doc:NotebookDocument=try decode(NotebookDocument.self,body,"record",limit:2_000_000)
            try await library.saveDraft(doc)
            return ["saved":true]
        case "noteReadDraft":return try json(try await library.readDraft(notebookID:string(body,"id",limit:256),path:string(body,"path",limit:4096)))
        default:
            let id=try string(body,"id",limit:256)
            let document:NotebookDocument
            if action=="noteCreate" {document=try await library.createNote(notebookID:id,name:string(body,"name",limit:180))}
            else if action=="noteRead" {
                let path=try string(body,"path",limit:4096)
                if let store=model.store,let managed=try await store.managedDocument(notebookID:id,path:path) {
                    let opened=try await todayCoordinator().open(documentID:managed.documentID)
                    var value=try json(NotebookDocument(notebookID:id,path:path,content:opened.content,revision:opened.revision)) as! [String:Any]
                    value["documentID"]=opened.documentID;value["readOnly"]=opened.readOnly;value["day"]=opened.day
                    return value
                }
                document=try await library.read(notebookID:id,path:path)
            }
            else if action=="noteSave" {
                let path=try string(body,"path",limit:4096),content=try string(body,"content",limit:256000),revision=try string(body,"revision",limit:128)
                if let store=model.store,let managed=try await store.managedDocument(notebookID:id,path:path) {
                    let saved=try await todayCoordinator().commit(documentID:managed.documentID,expectedRevision:revision,content:content,commandID:(body["commandID"] as? String) ?? "notebook:"+UUID().uuidString)
                    return try json(NotebookDocument(notebookID:id,path:path,content:saved.content,revision:saved.revision))
                }
                let disk=try await library.read(notebookID:id,path:path)
                guard ManagedMarkdown.documentID(disk.content)==nil else {throw MapleError.invalid("This copied managed document needs identity reconciliation. Open its original in Today.")}
                document=try await library.save(notebookID:id,path:path,content:content,expectedRevision:revision)
            }
            else {throw MapleError.invalid("Unsupported notebook action.")}
            if let store=model.store {
                // Notes use the same event ingestion boundary as every other connector.
                let event=Event(type:"note.updated",source:Source(connector:"notes",account:id,externalID:document.path,revision:document.revision),occurredAt:Date(),subjects:["person:self"],content:document.content)
                do {_ = try await store.ingestNotebookObservation(event)} catch {model.error="Note saved, but indexing needs a retry. Reopen the note to retry."}
            }
            return try json(document)
        }
    }
}
