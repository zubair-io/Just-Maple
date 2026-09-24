import Foundation
import CryptoKit

public struct Notebook: Codable, Sendable {
    public var id:String; public var name:String; public var location:String; public var cloud:Bool
    public var available:Bool; public var notes:[NotebookNote]; public var error:String?
}
public struct NotebookNote: Codable, Sendable {
    public var path:String; public var name:String; public var modifiedAt:Date
}
public struct NotebookDocument: Codable, Sendable {
    public var notebookID:String; public var path:String; public var content:String; public var revision:String
}
public struct NotebookCatalog: Codable, Sendable {
    public var notebooks:[Notebook]; public var cloudAvailable:Bool
}
/// Markdown files remain authoritative. SQLite receives note observations, never an editor document database.
public actor NotebookLibrary {
    struct Connection:Codable { var id:String; var name:String; var bookmark:Data }
    let registryURL:URL
    let cloudRoot:URL?
    private let prepareForRead: @Sendable (URL) async throws -> Void
    var connections:[Connection]
    var roots:[String:URL]=[:]
    var scoped:[URL]=[]
    public init(registryURL:URL, cloudRoot:URL?, prepareForRead: @escaping @Sendable (URL) async throws -> Void = NotebookDownloads.prepare) throws {
        self.prepareForRead=prepareForRead
        self.registryURL=registryURL;self.cloudRoot=cloudRoot
        connections=FileManager.default.fileExists(atPath:registryURL.path) ? try JSONDecoder().decode([Connection].self,from:Data(contentsOf:registryURL)) : []
    }
    deinit { for url in scoped {url.stopAccessingSecurityScopedResource()} }
    private static var bookmarkCreationOptions: URL.BookmarkCreationOptions {
        #if os(macOS)
        [.withSecurityScope]
        #else
        [.minimalBookmark]
        #endif
    }
    private static var bookmarkResolutionOptions: URL.BookmarkResolutionOptions {
        #if os(macOS)
        [.withSecurityScope, .withoutUI]
        #else
        [.withoutUI]
        #endif
    }
    static func key(_ url:URL)->String {SHA256.hash(data:Data(url.standardizedFileURL.resolvingSymlinksInPath().path.utf8)).map{String(format:"%02x",$0)}.joined()}
    static func revision(_ data:Data)->String {SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined()}
    func persist() throws {
        try FileManager.default.createDirectory(at:registryURL.deletingLastPathComponent(),withIntermediateDirectories:true)
        try JSONEncoder().encode(connections).write(to:registryURL,options:.atomic)
    }
    public func connect(_ url:URL) throws -> NotebookCatalog {
        let root=url.standardizedFileURL.resolvingSymlinksInPath()
        guard try root.resourceValues(forKeys:[.isDirectoryKey]).isDirectory == true else {throw NotebookError.invalid("Choose a folder for this notebook.")}
        let id=Self.key(root)
        if !connections.contains(where:{$0.id==id}) {
            let bookmark=try url.bookmarkData(options:Self.bookmarkCreationOptions,includingResourceValuesForKeys:nil,relativeTo:nil)
            connections.append(Connection(id:id,name:root.lastPathComponent,bookmark:bookmark))
            do {try persist()} catch {connections.removeLast();throw error}
        }
        return try catalog()
    }
    public func disconnect(_ id:String) throws -> NotebookCatalog {
        let old=connections;connections.removeAll{$0.id==id}
        do {try persist()} catch {connections=old;throw error}
        return try catalog()
    }
    public func createNotebook(name:String) throws -> NotebookCatalog {
        guard let cloudRoot else {throw NotebookError.invalid("iCloud Drive is unavailable. Connect a folder to start a notebook.")}
        try validateName(name)
        let target=cloudRoot.appendingPathComponent(name,isDirectory:true)
        guard !FileManager.default.fileExists(atPath:target.path) else {throw NotebookError.invalid("A notebook with this name already exists.")}
        try FileManager.default.createDirectory(at:target,withIntermediateDirectories:false)
        return try catalog()
    }
    func validateName(_ value:String) throws {
        guard !value.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,value.utf8.count<=180,!value.contains("/"),!value.contains(":"),!value.hasPrefix("."),!value.contains("\0") else {throw NotebookError.invalid("Use a visible file name without slashes or colons.")}
    }
    public func catalog() throws -> NotebookCatalog {
        for url in scoped {url.stopAccessingSecurityScopedResource()};scoped=[];roots=[:]
        var result:[Notebook]=[]
        if let root=cloudRoot,FileManager.default.fileExists(atPath:root.path) {
            let children=try FileManager.default.contentsOfDirectory(at:root,includingPropertiesForKeys:[.isDirectoryKey,.isSymbolicLinkKey,.isPackageKey],options:.skipsHiddenFiles)
            for folder in children {
                let v=try folder.resourceValues(forKeys:[.isDirectoryKey,.isSymbolicLinkKey,.isPackageKey])
                if v.isDirectory == true && v.isSymbolicLink != true && v.isPackage != true {result.append(scan(folder,cloud:true))}
            }
            if children.contains(where:{["md","markdown"].contains($0.pathExtension.lowercased())}) {result.append(scan(root,cloud:true,recursive:false))}
        }
        for connection in connections {
            do {
                var stale=false
                let url=try URL(resolvingBookmarkData:connection.bookmark,options:Self.bookmarkResolutionOptions,relativeTo:nil,bookmarkDataIsStale:&stale)
                if url.startAccessingSecurityScopedResource() {scoped.append(url)}
                if stale,let i=connections.firstIndex(where:{$0.id==connection.id}) {connections[i].bookmark=try url.bookmarkData(options:Self.bookmarkCreationOptions,includingResourceValuesForKeys:nil,relativeTo:nil);try persist()}
                if !result.contains(where:{$0.id==Self.key(url)}) {result.append(scan(url,cloud:false,id:connection.id))}
            } catch {result.append(Notebook(id:connection.id,name:connection.name,location:"Reconnect this folder",cloud:false,available:false,notes:[],error:"Folder access is unavailable. Connect it again."))}
        }
        return NotebookCatalog(notebooks:result.sorted{$0.name.localizedStandardCompare($1.name) == .orderedAscending},cloudAvailable:cloudRoot != nil)
    }
    func scan(_ root:URL,cloud:Bool,id:String? = nil,recursive:Bool = true)->Notebook {
        let root=root.standardizedFileURL.resolvingSymlinksInPath()
        let id=id ?? Self.key(root)
        var notebook=Notebook(id:id,name:root.lastPathComponent,location:root.path,cloud:cloud,available:true,notes:[])
        roots[id]=root
        do {
            guard try root.resourceValues(forKeys:[.isDirectoryKey]).isDirectory == true else {throw NotebookError.invalid("Folder unavailable")}
            var options:FileManager.DirectoryEnumerationOptions=[.skipsHiddenFiles,.skipsPackageDescendants]
            if !recursive {options.insert(.skipsSubdirectoryDescendants)}
            var enumerationError:Error?
            guard let files=FileManager.default.enumerator(at:root,includingPropertiesForKeys:[.isSymbolicLinkKey,.isRegularFileKey,.contentModificationDateKey],options:options,errorHandler:{_,error in enumerationError=error;return false}) else {throw NotebookError.invalid("Could not read notebook")}
            for case let file as URL in files {
                let values=try file.resourceValues(forKeys:[.isSymbolicLinkKey,.isRegularFileKey,.contentModificationDateKey])
                if values.isSymbolicLink == true {files.skipDescendants();continue}
                guard values.isRegularFile == true,["md","markdown"].contains(file.pathExtension.lowercased()) else {continue}
                guard notebook.notes.count<5000 else {throw NotebookError.invalid("This notebook exceeds 5,000 notes. Connect a smaller folder.")}
                notebook.notes.append(NotebookNote(path:String(file.path.dropFirst(root.path.count+1)),name:file.deletingPathExtension().lastPathComponent,modifiedAt:values.contentModificationDate ?? .distantPast))
            }
            if let enumerationError {throw enumerationError}
            notebook.notes.sort{$0.modifiedAt>$1.modifiedAt}
        } catch {notebook.available=false;notebook.error=error.localizedDescription}
        return notebook
    }
    func file(_ id:String,_ path:String) throws -> URL {
        guard let root=roots[id],!path.isEmpty,!path.hasPrefix("/"),!path.split(separator:"/").contains(where:{$0==".." || $0.hasPrefix(".")}),["md","markdown"].contains(URL(fileURLWithPath:path).pathExtension.lowercased()) else {throw NotebookError.invalid("Choose a Markdown note in a connected notebook.")}
        let file=root.appendingPathComponent(path).standardizedFileURL
        let resolved=file.resolvingSymlinksInPath(),base=root.resolvingSymlinksInPath().standardizedFileURL.path+"/"
        guard resolved.path.hasPrefix(base),resolved.path==file.path else {throw NotebookError.invalid("Linked files outside the notebook cannot be edited.")}
        return file
    }
    public func read(notebookID:String,path:String) async throws -> NotebookDocument {
        let original=try file(notebookID,path)
        try await prepareForRead(original)
        try Task.checkCancellation()
        let url=try file(notebookID,path)
        guard url==original else {throw NotebookError.invalid("This notebook moved. Open it again from the notebook list.")}
        var coordination:NSError?,result:Result<NotebookDocument,Error>?
        NSFileCoordinator().coordinate(readingItemAt:url,options:[],error:&coordination) { target in result=Result {
            let data=try boundedData(target)
            guard let text=String(data:data,encoding:.utf8) else {throw NotebookError.invalid("This note must use UTF-8 encoding.")}
            return NotebookDocument(notebookID:notebookID,path:path,content:text,revision:Self.revision(data))
        }}
        if let coordination {throw coordination};return try result!.get()
    }
    func boundedData(_ url:URL) throws -> Data {
        let values=try url.resourceValues(forKeys:[.isRegularFileKey,.fileSizeKey])
        guard values.isRegularFile==true,(values.fileSize ?? Int.max)<=256000 else {throw NotebookError.invalid("Open a regular Markdown file smaller than 256 KB.")}
        return try Data(contentsOf:url)
    }
    public func save(notebookID:String,path:String,content:String,expectedRevision:String?) throws -> NotebookDocument {
        guard content.utf8.count<=256000 else {throw NotebookError.invalid("Notes are limited to 256 KB.")}
        let url=try file(notebookID,path)
        var coordination:NSError?,failure:Error?
        NSFileCoordinator().coordinate(writingItemAt:url,options:.forReplacing,error:&coordination) { target in
            do {
                let exists=FileManager.default.fileExists(atPath:target.path)
                if let expectedRevision {
                    guard exists,Self.revision(try boundedData(target))==expectedRevision else {throw NotebookError.invalid("This note changed in another app or iCloud. Your draft is kept. Reload the file or save a copy.")}
                } else if exists {throw NotebookError.invalid("A note with this name already exists.")}
                try Data(content.utf8).write(to:target,options:.atomic)
            } catch {failure=error}
        }
        if let coordination {throw coordination};if let failure {throw failure}
        let draft=draftURL(notebookID,path)
        if let data=try? Data(contentsOf:draft),let saved=try? NotebookCodec.decode(NotebookDocument.self,from:data),saved.content==content {try? FileManager.default.removeItem(at:draft)}
        return NotebookDocument(notebookID:notebookID,path:path,content:content,revision:Self.revision(Data(content.utf8)))
    }
    public func createNote(notebookID:String,name:String) throws -> NotebookDocument {
        try validateName(name)
        return try save(notebookID:notebookID,path:name+".md",content:"# \(name)\n\n",expectedRevision:nil)
    }
}

extension NotebookLibrary {
    func draftURL(_ id:String,_ path:String)->URL {
        registryURL.deletingLastPathComponent().appendingPathComponent("NotebookDrafts").appendingPathComponent(Self.revision(Data((id+"\n"+path).utf8))+".json")
    }
    public func saveDraft(_ document:NotebookDocument) throws {
        _ = try file(document.notebookID,document.path)
        guard document.content.utf8.count<=256000 else {throw NotebookError.invalid("Draft is too large.")}
        let url=draftURL(document.notebookID,document.path)
        try FileManager.default.createDirectory(at:url.deletingLastPathComponent(),withIntermediateDirectories:true)
        try NotebookCodec.encode(document).write(to:url,options:.atomic)
    }
    public func readDraft(notebookID:String,path:String) throws -> NotebookDocument? {
        _ = try file(notebookID,path)
        let url=draftURL(notebookID,path)
        guard FileManager.default.fileExists(atPath:url.path) else {return nil}
        return try NotebookCodec.decode(NotebookDocument.self,from:Data(contentsOf:url))
    }
}

public enum NotebookError: Error, LocalizedError, Sendable {
    case invalid(String)
    public var errorDescription: String? { switch self { case .invalid(let message): message } }
}
private enum NotebookCodec {
    static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .secondsSince1970
        encoder.outputFormatting = [.sortedKeys]; return try encoder.encode(value)
    }
    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .secondsSince1970
        return try decoder.decode(type, from: data)
    }
}
