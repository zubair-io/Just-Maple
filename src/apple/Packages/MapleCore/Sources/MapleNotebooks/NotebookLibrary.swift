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
    public var acceptedAutomaticBlockIDs:[String]?
    public var acceptedReplyRunIDs:[String]?
    public init(notebookID:String,path:String,content:String,revision:String,acceptedAutomaticBlockIDs:[String]?=nil,acceptedReplyRunIDs:[String]?=nil) {self.notebookID=notebookID;self.path=path;self.content=content;self.revision=revision;self.acceptedAutomaticBlockIDs=acceptedAutomaticBlockIDs;self.acceptedReplyRunIDs=acceptedReplyRunIDs}
}
public struct NotebookCatalog: Codable, Sendable {
    public var notebooks:[Notebook]; public var cloudAvailable:Bool
}
/// Markdown files remain authoritative. SQLite receives note observations, never an editor document database.
public actor NotebookLibrary {
    struct Connection:Codable { var id:String; var name:String; var bookmark:Data }
    let registryURL:URL
    var cloudRoot:URL?
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
    /// Restore an initially unavailable container without replacing this actor's
    /// connected folders, active operations or local draft storage.
    public func restoreCloudRootIfNeeded(_ root:URL) throws {
        guard cloudRoot==nil else{return}
        cloudRoot=root
        do {_ = try catalog()}
        catch {cloudRoot=nil;throw error}
    }
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
        let placeholder=cloudRoot.appendingPathComponent("."+name+".icloud")
        guard !FileManager.default.fileExists(atPath:target.path),!FileManager.default.fileExists(atPath:placeholder.path) else {throw NotebookError.invalid("A notebook with this name already exists, or is still downloading from iCloud.")}
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
                } else {
                    let placeholder=target.deletingLastPathComponent().appendingPathComponent("."+target.lastPathComponent+".icloud")
                    guard !exists && !FileManager.default.fileExists(atPath:placeholder.path) else {
                        throw NotebookError.invalid("A note with this name already exists, or is still downloading from iCloud. Open it or choose another name.")
                    }
                }
                try Data(content.utf8).write(to:target,options:.atomic)
            } catch {failure=error}
        }
        if let coordination {throw coordination};if let failure {throw failure}
        let draft=draftURL(notebookID,path)
        // Equal prose can carry newer delivery/deletion receipts than the save
        // captured. Keep that sidecar until the coordinator can acknowledge its
        // metadata against the durable journal; file replacement alone cannot.
        if let data=try? Data(contentsOf:draft),let saved=try? NotebookCodec.decode(NotebookDocument.self,from:data),saved.content==content,(saved.acceptedAutomaticBlockIDs ?? []).isEmpty,(saved.acceptedReplyRunIDs ?? []).isEmpty {try? FileManager.default.removeItem(at:draft)}
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
    /// Advance only a retained draft from the exact baseline of an acknowledged user
    /// save. Generated writes and external revisions never rebase somebody's writing.
    public func rebaseDraftAfterCommit(notebookID:String,path:String,expectedRevision:String?,targetRevision:String) async throws {
        guard let expectedRevision,
              let draft=try readDraft(notebookID:notebookID,path:path),draft.revision==expectedRevision,
              let disk=try await readIfPresent(notebookID:notebookID,path:path),disk.revision==targetRevision else{return}
        // readIfPresent may suspend for iCloud. Re-read the draft after that await so a
        // newer baseline or newer text is never replaced by our earlier snapshot.
        guard let latest=try readDraft(notebookID:notebookID,path:path),latest.revision==expectedRevision else{return}
        try saveDraft(NotebookDocument(notebookID:notebookID,path:path,content:latest.content,revision:targetRevision,acceptedAutomaticBlockIDs:latest.acceptedAutomaticBlockIDs,acceptedReplyRunIDs:latest.acceptedReplyRunIDs))
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

extension NotebookLibrary {
    /// Today has one fixed home in this app's iCloud Documents container. A missing cloud
    /// grant is an error, never permission to choose another notebook or a local directory.
    public func ensureJustMapleDailyNotebook() throws -> String {
        guard let cloudRoot else {throw NotebookError.invalid("iCloud Drive is unavailable. Sign in to iCloud and enable iCloud Drive for Just Maple to open Today.")}
        let keys:Set<URLResourceKey>=[.isDirectoryKey,.isSymbolicLinkKey]
        guard let values=try? cloudRoot.resourceValues(forKeys:keys),values.isDirectory==true,values.isSymbolicLink != true else {throw NotebookError.invalid("The Just Maple iCloud Documents folder is unavailable. Reconnect iCloud Drive; Today will not use another folder.")}
        let destination=cloudRoot.appendingPathComponent("Just Maple",isDirectory:true)
        let placeholder=cloudRoot.appendingPathComponent(".Just Maple.icloud")
        guard !FileManager.default.fileExists(atPath:placeholder.path) || FileManager.default.fileExists(atPath:destination.path) else {throw NotebookError.invalid("The Just Maple iCloud folder is still downloading. Wait for iCloud Drive; its placeholder will not be replaced.")}
        if let existing=try? destination.resourceValues(forKeys:keys) {
            guard existing.isDirectory==true,existing.isSymbolicLink != true else {throw NotebookError.invalid("iCloud already contains a file or linked folder named Just Maple. Resolve it before creating daily notes.")}
        }
        do {try createDailyDirectoryIfAbsent(destination)}
        catch {throw NotebookError.invalid("The Just Maple folder could not be opened in iCloud Drive. Check for a file or linked folder with that name, then try again.")}
        let current=try destination.resourceValues(forKeys:keys)
        guard current.isDirectory==true,current.isSymbolicLink != true else {throw NotebookError.invalid("The Just Maple iCloud folder changed. Reopen Today after checking iCloud Drive.")}
        let result=try catalog(),id=Self.key(destination)
        guard result.notebooks.contains(where:{$0.id==id && $0.cloud && $0.available}) else {throw NotebookError.invalid("The Just Maple iCloud notebook is unavailable. Today will not use another notebook.")}
        return id
    }
    /// Creates only validated year/month folders inside a granted notebook.
    /// Returns the relative YYYY/MM directory used for a local calendar day.
    @discardableResult
    public func prepareDailyDirectory(notebookID:String,day:String) throws -> String {
        guard day.range(of:#"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"#,options:.regularExpression) != nil,!day.hasPrefix("0000") else {throw NotebookError.invalid("Choose a valid YYYY-MM-DD calendar date.")}
        let formatter=DateFormatter();formatter.locale=Locale(identifier:"en_US_POSIX");formatter.calendar=Calendar(identifier:.gregorian);formatter.timeZone=TimeZone(secondsFromGMT:0);formatter.dateFormat="yyyy-MM-dd";formatter.isLenient=false
        guard let date=formatter.date(from:day),formatter.string(from:date)==day else {throw NotebookError.invalid("Choose a valid calendar date for the daily folder.")}
        let year=String(day.prefix(4)),month=String(day.dropFirst(5).prefix(2))
        for relative in [year,year+"/"+month] {
            let probe=relative+"/placeholder.md"
            let destination=try file(notebookID,probe).deletingLastPathComponent()
            try createDailyDirectoryIfAbsent(destination)
            _ = try file(notebookID,probe)
        }
        return year+"/"+month
    }
    private func createDailyDirectoryIfAbsent(_ destination:URL) throws {
        let keys:Set<URLResourceKey>=[.isDirectoryKey,.isSymbolicLinkKey]
        func validatedExistingDirectory() throws -> Bool {
            do {
                let values=try URL(fileURLWithPath:destination.path).resourceValues(forKeys:keys)
                guard values.isDirectory==true,values.isSymbolicLink != true else {throw NotebookError.invalid("A daily-note folder is occupied by a file or symbolic link. Resolve the collision before continuing.")}
                return true
            } catch let error as NSError where error.domain==NSCocoaErrorDomain && error.code==NSFileReadNoSuchFileError {return false}
        }
        if try validatedExistingDirectory() {return}
        do {try FileManager.default.createDirectory(at:destination,withIntermediateDirectories:false)}
        catch {
            // Another opener may have created this exact directory. Only accept a verified
            // real directory; a racing file or symlink remains a visible conflict.
            guard try validatedExistingDirectory() else {throw error}
        }
        guard try validatedExistingDirectory() else {throw NotebookError.invalid("The daily-note directory is unavailable. Try again after checking iCloud Drive.")}
    }
    /// Compatibility helper for reading/testing the previous layout; new daily writes use
    /// the calendar-validated overload above.
    public func prepareDailyDirectory(notebookID:String) throws {
        let destination=try file(notebookID,"Daily/placeholder.md").deletingLastPathComponent()
        try FileManager.default.createDirectory(at:destination,withIntermediateDirectories:true)
    }
    public func readIfPresent(notebookID:String,path:String) async throws -> NotebookDocument? {
        let url=try file(notebookID,path)
        let placeholder=url.deletingLastPathComponent().appendingPathComponent("."+url.lastPathComponent+".icloud")
        if FileManager.default.fileExists(atPath:placeholder.path) {return try await read(notebookID:notebookID,path:path)}
        // Do not classify permission, download or malformed-data failures as absence.
        do {_ = try url.resourceValues(forKeys:[.isRegularFileKey])}
        catch let error as NSError where error.domain==NSCocoaErrorDomain && error.code==NSFileReadNoSuchFileError {return nil}
        return try await read(notebookID:notebookID,path:path)
    }
}

extension NotebookLibrary {
    /// A save command can arrive after the next keystroke's durable draft. Never replace that
    /// newer/different draft with captured command bytes; the coordinator journals those bytes.
    public func preserveCommitDraft(_ document:NotebookDocument) throws {
        var preserved=document
        if let existing=try readDraft(notebookID:document.notebookID,path:document.path) {
            guard existing.content == document.content else {return}
            let receipts=Set((existing.acceptedAutomaticBlockIDs ?? [])+(document.acceptedAutomaticBlockIDs ?? [])).sorted()
            preserved.acceptedAutomaticBlockIDs=receipts.isEmpty ? nil:receipts
            let replies=Set((existing.acceptedReplyRunIDs ?? [])+(document.acceptedReplyRunIDs ?? [])).sorted()
            preserved.acceptedReplyRunIDs=replies.isEmpty ? nil:replies
        }
        try saveDraft(preserved)
    }
}
