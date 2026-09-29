import Foundation
import AppKit
import MapleCore
import MapleNotebooks

extension Bridge {
    func attachmentCommand(_ action:String,_ body:[String:Any]) async throws -> Any {
        guard let store=model.store else {throw MapleError.invalid("Your local workspace is not ready.")}
        guard let document=try await store.managedDocument(id:string(body,"documentID",limit:128)) else {throw MapleError.invalid("Open a registered document before adding attachments.")}
        let library=try await notebookLibrary()
        switch action {
        case "attachmentImport":
            return try json(try await library.importAttachment(notebookID:document.notebookID,path:document.path,name:string(body,"name",limit:255),mimeType:string(body,"mimeType",limit:128),base64:string(body,"base64",limit:NotebookLibrary.attachmentBase64Limit)))
        case "attachmentRead":
            return try json(try await library.readAttachment(notebookID:document.notebookID,path:document.path,ref:string(body,"ref",limit:128)))
        case "attachmentExport":
            let ref=try string(body,"ref",limit:128),name=try string(body,"name",limit:255)
            let result=try await library.readAttachment(notebookID:document.notebookID,path:document.path,ref:ref)
            guard result.status=="ready",let url=result.dataURL,let comma=url.firstIndex(of:","),let bytes=Data(base64Encoded:String(url[url.index(after:comma)...])) else {throw MapleError.invalid("Restore this attachment in your notebook before saving a copy.")}
            let panel=NSSavePanel();panel.nameFieldStringValue=URL(fileURLWithPath:name).lastPathComponent
            guard panel.runModal() == .OK,let destination=panel.url else {return ["saved":false]}
            try bytes.write(to:destination,options:.atomic)
            return ["saved":true]
        default:throw MapleError.invalid("Unsupported attachment action.")
        }
    }
}
