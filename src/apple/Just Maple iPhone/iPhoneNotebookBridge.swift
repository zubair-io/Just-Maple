import CryptoKit
import Foundation
import MapleNotebooks
import UIKit
import UniformTypeIdentifiers

/// Files remain authoritative and work without a connected Mac. Only successful edits enter the outbox.
@MainActor final class iPhoneNotebookBridge: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    private let directory: URL
    private let cloudRootProvider: @Sendable () async -> URL?
    private var library: NotebookLibrary?
    private var picking: CheckedContinuation<URL?, Never>?
    private(set) var indexingNotice: String?

    init(directory: URL, library: NotebookLibrary? = nil,
         cloudRootProvider: @escaping @Sendable () async -> URL? = {
             await Task.detached(priority: .utility) {
                 FileManager.default.url(forUbiquityContainerIdentifier: "iCloud.com.just.maple.JapaneseMaple")?.appendingPathComponent("Documents", isDirectory: true)
             }.value
         }) {
        self.directory = directory; self.library = library; self.cloudRootProvider = cloudRootProvider
    }

    static let actions: Set<String> = ["notebookCatalog", "notebookConnect", "notebookDisconnect", "notebookCreate", "noteDraft", "noteReadDraft", "noteCreate", "noteRead", "noteSave"]

    func command(_ action: String, body: [String: Any], presenting: UIViewController? = nil, store: CompanionStore) async throws -> Any {
        guard Self.actions.contains(action) else { throw NotebookError.invalid("Unsupported notebook action.") }
        let library = try await notebookLibrary()
        switch action {
        case "notebookCatalog": return try json(try await library.catalog())
        case "notebookConnect":
            guard let presenting else { throw NotebookError.invalid("Open Maple to choose a notebook folder.") }
            guard let url = try await chooseFolder(presenting: presenting) else { return try json(try await library.catalog()) }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            return try json(try await library.connect(url))
        case "notebookDisconnect": return try json(try await library.disconnect(string(body, "id", limit: 256)))
        case "notebookCreate": return try json(try await library.createNotebook(name: string(body, "name", limit: 180)))
        case "noteDraft":
            guard let record = body["record"], JSONSerialization.isValidJSONObject(record) else { throw NotebookError.invalid("Invalid notebook draft.") }
            let data = try JSONSerialization.data(withJSONObject: record)
            guard data.count <= 2_000_000 else { throw NotebookError.invalid("Draft is too large.") }
            let document = try JSONDecoder().decode(NotebookDocument.self, from: data)
            try await library.saveDraft(document)
            return ["saved": true]
        case "noteReadDraft": return try json(try await library.readDraft(notebookID: string(body, "id", limit: 256), path: string(body, "path", limit: 4096)))
        default:
            let id = try string(body, "id", limit: 256)
            let document: NotebookDocument
            switch action {
            case "noteCreate": document = try await library.createNote(notebookID: id, name: string(body, "name", limit: 180))
            case "noteSave": document = try await library.save(notebookID: id, path: string(body, "path", limit: 4096), content: string(body, "content", limit: 256000, allowEmpty: true), expectedRevision: string(body, "revision", limit: 128))
            default: document = try await library.read(notebookID: id, path: string(body, "path", limit: 4096))
            }
            indexingNotice = nil
            if action != "noteRead" {
                if document.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    indexingNotice = "Saved to your notebook. Empty notes do not create an observation."
                } else if document.content.utf8.count > 16_000 {
                    indexingNotice = "Saved to your notebook. Notes larger than 16 KB are not yet sent to your Mac for indexing."
                } else {
                    do { try store.capture(id: Self.captureID(document).uuidString.lowercased(), text: document.content) }
                    catch { indexingNotice = "Saved to your notebook, but this edit could not be queued for your Mac. Save again to retry." }
                }
            }
            var result = try json(document) as! [String: Any]
            if let indexingNotice { result["indexingWarning"] = indexingNotice }
            return result
        }
    }

    static func captureID(_ document: NotebookDocument) -> UUID {
        // Length-safe serialization prevents path/newline ambiguities. Device identity scopes the Mac receipt.
        let data = try! JSONEncoder().encode([document.notebookID, document.path, document.revision])
        var bytes = Array(SHA256.hash(data: data).prefix(16))
        bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80
        return UUID(uuid: (bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]))
    }
    private func notebookLibrary() async throws -> NotebookLibrary {
        if let library { return library }
        let root = await cloudRootProvider()
        if let root { try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true) }
        if let library { return library }
        let created = try NotebookLibrary(registryURL: directory.appendingPathComponent("notebooks.json"), cloudRoot: root)
        _ = try await created.catalog()
        library = created; return created
    }
    private func string(_ body: [String: Any], _ key: String, limit: Int, allowEmpty: Bool = false) throws -> String {
        guard let value = body[key] as? String, value.utf8.count <= limit, allowEmpty || !value.isEmpty else { throw NotebookError.invalid("Invalid notebook field: \(key).") }
        return value
    }
    private func json<T: Encodable>(_ value: T) throws -> Any {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .secondsSince1970
        return try JSONSerialization.jsonObject(with: encoder.encode(value), options: [.fragmentsAllowed])
    }
    private func chooseFolder(presenting: UIViewController) async throws -> URL? {
        guard picking == nil, presenting.presentedViewController == nil else { throw NotebookError.invalid("Finish choosing the current folder first.") }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
        picker.allowsMultipleSelection = false; picker.delegate = self
        return await withCheckedContinuation { continuation in
            picking = continuation
            presenting.present(picker, animated: true)
            picker.presentationController?.delegate = self
        }
    }
    private func finishPicker(_ url: URL?) { let continuation = picking; picking = nil; continuation?.resume(returning: url) }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finishPicker(urls.first) }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finishPicker(nil) }
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { finishPicker(nil) }
}
