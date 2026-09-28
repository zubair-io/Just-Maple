import Foundation
import ImageIO

public struct NotebookAttachment: Codable, Sendable {
    public var ref: String
    public var name: String
    public var mimeType: String
    public var byteCount: Int
    public var kind: String
}
public struct NotebookAttachmentRead: Codable, Sendable {
    public var status: String
    public var dataURL: String?
    public var byteCount: Int?
}

extension NotebookLibrary {
    public static let attachmentByteLimit = 12 * 1024 * 1024
    public static let attachmentBase64Limit = ((attachmentByteLimit + 2) / 3) * 4
    /// The only supported references are immutable files in the notebook’s Attachments folder.
    /// No caller-controlled absolute URL, remote URL or parent-directory segment is used.
    public static func validAttachmentReference(_ ref: String) -> Bool {
        ref.range(of: #"^Attachments/[a-f0-9]{64}\.(png|jpg|gif|webp|pdf|txt|m4a|mp3|wav|bin)$"#, options: .regularExpression) != nil
    }
    func attachmentURL(notebookID: String, path: String, ref: String) throws -> URL {
        guard Self.validAttachmentReference(ref) else {throw NotebookError.invalid("Invalid attachment reference.")}
        _ = try file(notebookID, path)
        guard let parent = roots[notebookID] else {throw NotebookError.invalid("Reconnect this notebook to access attachments.")}
        let result = parent.appendingPathComponent(ref).standardizedFileURL
        guard result.resolvingSymlinksInPath().path == result.path else {throw NotebookError.invalid("Linked attachment paths are not supported.")}
        // Reject even same-target symlinks and nonregular existing files.
        for (url, directory) in [(result.deletingLastPathComponent(), true), (result, false)] {
            do {
                let values = try url.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey, .isRegularFileKey])
                guard values.isSymbolicLink != true, directory ? values.isDirectory == true : values.isRegularFile == true else {throw NotebookError.invalid("An attachment path is occupied by a linked or unsupported file.")}
            } catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError {}
        }
        return result
    }
    static func attachmentType(_ data: Data, mimeType: String) throws -> (mime: String, ext: String, kind: String) {
        if mimeType.hasPrefix("image/") {
            guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                  let type = CGImageSourceGetType(source) as String?,
                  let pair = ["public.png":("image/png","png"), "public.jpeg":("image/jpeg","jpg"), "com.compuserve.gif":("image/gif","gif"), "org.webmproject.webp":("image/webp","webp")][type],
                  let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString:Any],
                  let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
                  let height = properties[kCGImagePropertyPixelHeight] as? NSNumber,
                  width.int64Value > 0, height.int64Value > 0, width.int64Value <= 20000, height.int64Value <= 20000,
                  width.int64Value * height.int64Value <= 40_000_000 else {throw NotebookError.invalid("Use a PNG, JPEG, GIF or WebP image under 40 megapixels.")}
            return (pair.0,pair.1,"image")
        }
        let safe = ["application/pdf":"pdf", "text/plain":"txt", "audio/mp4":"m4a", "audio/mpeg":"mp3", "audio/wav":"wav"]
        if let ext = safe[mimeType] {return (mimeType,ext,"file")}
        return ("application/octet-stream","bin","file")
    }
    /// Copies bounded bytes; never stores a path supplied by the web view or modifies a note.
    public func importAttachment(notebookID: String, path: String, name: String, mimeType: String, base64: String) throws -> NotebookAttachment {
        guard base64.utf8.count <= Self.attachmentBase64Limit,
              let data = Data(base64Encoded:base64), !data.isEmpty, data.count <= Self.attachmentByteLimit else {throw NotebookError.invalid("Choose a nonempty attachment up to 12 MiB.")}
        guard !name.isEmpty, name.utf8.count <= 255, !name.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) else {throw NotebookError.invalid("Use an attachment name up to 255 bytes without control characters.")}
        let type = try Self.attachmentType(data,mimeType:mimeType)
        let ref = "Attachments/" + Self.revision(data) + "." + type.ext
        let destination = try attachmentURL(notebookID:notebookID,path:path,ref:ref)
        let directory = destination.deletingLastPathComponent()
        let coordinator = NSFileCoordinator();var coordinationError:NSError?, failure:Error?
        coordinator.coordinate(writingItemAt:directory, options:[], error:&coordinationError) { _ in
            do {
                _ = try attachmentURL(notebookID:notebookID,path:path,ref:ref)
                if !FileManager.default.fileExists(atPath:directory.path) {try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:false)}
                _ = try attachmentURL(notebookID:notebookID,path:path,ref:ref)
                let placeholder = directory.appendingPathComponent("." + destination.lastPathComponent + ".icloud")
                if FileManager.default.fileExists(atPath:placeholder.path) {throw NotebookError.invalid("This attachment is still in iCloud. Download it before importing the same file again.")}
                if FileManager.default.fileExists(atPath:destination.path) {
                    let existing = try Self.boundedAttachmentRead(destination)
                    guard existing == data else {throw NotebookError.invalid("The existing attachment changed outside Just Maple. Restore it before importing this file.")}
                } else {
                    let temporary = directory.appendingPathComponent(".maple-import-" + UUID().uuidString)
                    defer {try? FileManager.default.removeItem(at:temporary)}
                    try data.write(to:temporary,options:.atomic)
                    // moveItem refuses existing targets. A concurrent matching import is safe;
                    // different bytes and external edits are never overwritten.
                    do {try FileManager.default.moveItem(at:temporary,to:destination)}
                    catch {
                        _ = try attachmentURL(notebookID:notebookID,path:path,ref:ref)
                        guard FileManager.default.fileExists(atPath:destination.path),try Self.boundedAttachmentRead(destination) == data else {throw error}
                    }
                }
            } catch {failure = error}
        }
        if let error = coordinationError {throw error};if let failure {throw failure}
        return NotebookAttachment(ref:ref,name:name,mimeType:type.mime,byteCount:data.count,kind:type.kind)
    }
    static func boundedAttachmentRead(_ url: URL) throws -> Data {
        let handle = try FileHandle(forReadingFrom:url);defer {try? handle.close()}
        let data = try handle.read(upToCount:attachmentByteLimit+1) ?? Data()
        guard !data.isEmpty,data.count <= attachmentByteLimit else {throw NotebookError.invalid("This attachment is empty or exceeds 12 MiB.")}
        return data
    }
    public func readAttachment(notebookID: String, path: String, ref: String) async throws -> NotebookAttachmentRead {
        let url = try attachmentURL(notebookID:notebookID,path:path,ref:ref)
        try await NotebookDownloads.prepare(url)
        _ = try attachmentURL(notebookID:notebookID,path:path,ref:ref)
        guard FileManager.default.fileExists(atPath:url.path) else {return NotebookAttachmentRead(status:"missing")}
        let coordinator = NSFileCoordinator();var coordinationError:NSError?, result:Result<Data,Error>?
        coordinator.coordinate(readingItemAt:url,options:[],error:&coordinationError) { _ in
            result = Result { _ = try attachmentURL(notebookID:notebookID,path:path,ref:ref);return try Self.boundedAttachmentRead(url) }
        }
        if let error = coordinationError {throw error}
        guard let result else {throw NotebookError.invalid("Could not read the attachment.")}
        let data = try result.get(), hash = url.deletingPathExtension().lastPathComponent
        guard Self.revision(data) == hash else {throw NotebookError.invalid("The attachment was changed outside Just Maple. Restore its original bytes or import it as a new attachment.")}
        let mime = ["png":"image/png","jpg":"image/jpeg","gif":"image/gif","webp":"image/webp","pdf":"application/pdf","txt":"text/plain","m4a":"audio/mp4","mp3":"audio/mpeg","wav":"audio/wav"][url.pathExtension] ?? "application/octet-stream"
        _ = try Self.attachmentType(data,mimeType:mime)
        return NotebookAttachmentRead(status:"ready",dataURL:"data:" + mime + ";base64," + data.base64EncodedString(),byteCount:data.count)
    }
}
