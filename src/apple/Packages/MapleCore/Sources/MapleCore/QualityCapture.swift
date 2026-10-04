import Foundation
import CryptoKit
import Darwin

public struct QualityCaptureRequest:Codable,Sendable {
    public let schemaVersion:Int,captureID:String,worldRevision:Int64,worldJSON:String,worldSHA256:String,projectionJSON:String,projectionSHA256:String,capturedAt:String
    public init(schemaVersion:Int=1,captureID:String,worldRevision:Int64,worldJSON:String,worldSHA256:String,projectionJSON:String,projectionSHA256:String,capturedAt:String) {
        self.schemaVersion=schemaVersion;self.captureID=captureID;self.worldRevision=worldRevision;self.worldJSON=worldJSON;self.worldSHA256=worldSHA256;self.projectionJSON=projectionJSON;self.projectionSHA256=projectionSHA256;self.capturedAt=capturedAt
    }
}
public struct QualityCaptureReceipt:Codable,Sendable {
    public let schemaVersion:Int,captureID:String,status:String,path:String?,capturedAt:String?,worldRevision:Int64?,worldSHA256:String?,projectionSHA256:String?,evaluation:String?,message:String?
}
private struct QualityCaptureManifest:Codable {
    let schemaVersion:Int,requestSHA256:String,databaseSHA256:String,databaseBytes:Int64
    let receipt:QualityCaptureReceipt
    let pipelineCoverage:String,coverageReason:String,projectionValidation:String
    let dispatchIntentCount:Int,undispatchedAuditCount:Int
    let databaseReadStartedAt:Date,databaseReadFinishedAt:Date
}

extension KnowledgeStore {
    /// Explicit, local-only capture. Retried committed IDs are returned before comparing mutable state.
    /// This is a reproducible input bundle, not a predictions file or a quality score.
    public func captureQualitySnapshot(_ request:QualityCaptureRequest,expectedWorld:WorldSnapshot?,directory:URL)throws -> QualityCaptureReceipt {
        guard request.schemaVersion==1,UUID(uuidString:request.captureID) != nil,request.worldRevision>=0,
              request.worldJSON.utf8.count<=32*1024*1024,request.projectionJSON.utf8.count<=8*1024*1024,
              request.worldSHA256==Self.captureHash(Data(request.worldJSON.utf8)),request.projectionSHA256==Self.captureHash(Data(request.projectionJSON.utf8)),
              let captured=Self.captureDate(request.capturedAt),captured<=Date().addingTimeInterval(60) else {throw MapleError.invalid("Invalid local quality capture payload.")}
        let fm=FileManager.default,final=directory.appendingPathComponent(request.captureID.lowercased(),isDirectory:true)
        let requestHash=Self.captureHash(try JSONCodec.encode(request))
        try Self.privateCaptureDirectory(directory)
        if fm.fileExists(atPath:final.path) {
            try Self.requireRegularCaptureDirectory(final)
            let manifestURL=final.appendingPathComponent("capture.json")
            _ = try Self.captureFileHash(manifestURL) // Reject symlinks/non-regular receipts before reading.
            let manifest=try JSONCodec.decode(QualityCaptureManifest.self,from:Data(contentsOf:manifestURL))
            guard manifest.requestSHA256==requestHash else {throw MapleError.invalid("Capture identity was reused with different data.")}
            let receipt=manifest.receipt
            guard manifest.schemaVersion==1,receipt.schemaVersion==1,receipt.captureID==request.captureID,receipt.status=="saved",receipt.path==final.path,
                  receipt.capturedAt==request.capturedAt,receipt.worldRevision==request.worldRevision,receipt.worldSHA256==request.worldSHA256,
                  receipt.projectionSHA256==request.projectionSHA256,receipt.evaluation=="not_run",receipt.message==nil,
                  (try fm.attributesOfItem(atPath:final.appendingPathComponent("core.sqlite").path)[.size] as? NSNumber)?.int64Value==manifest.databaseBytes else {
                throw MapleError.invalid("The saved capture receipt is invalid. Create a new capture.")
            }
            guard try Self.captureFileHash(final.appendingPathComponent("core.sqlite"))==manifest.databaseSHA256,
                  try Self.captureFileHash(final.appendingPathComponent("world.json"))==request.worldSHA256,
                  try Self.captureFileHash(final.appendingPathComponent("projection.json"))==request.projectionSHA256 else {throw MapleError.invalid("The saved capture is incomplete or changed. Create a new capture.")}
            return manifest.receipt
        }
        func stale()->QualityCaptureReceipt {QualityCaptureReceipt(schemaVersion:1,captureID:request.captureID,status:"stale",path:nil,capturedAt:nil,worldRevision:nil,worldSHA256:nil,projectionSHA256:nil,evaluation:nil,message:"The task snapshot changed. Capture current lists again.")}
        guard let expectedWorld,expectedWorld.revision==request.worldRevision,
              try Self.captureObjectsEqual(Data(request.worldJSON.utf8),JSONCodec.encode(expectedWorld)),
              expectedWorld.asOf<=captured else {return stale()}
        try validateQualityProjection(request,world:expectedWorld)
        let staging=directory.appendingPathComponent(".pending-"+UUID().uuidString,isDirectory:true)
        try Self.privateCaptureDirectory(staging)
        defer {try? fm.removeItem(at:staging)}
        let receipt=QualityCaptureReceipt(schemaVersion:1,captureID:request.captureID,status:"saved",path:final.path,capturedAt:request.capturedAt,worldRevision:request.worldRevision,worldSHA256:request.worldSHA256,projectionSHA256:request.projectionSHA256,evaluation:"not_run",message:nil)
        let result:QualityCaptureManifest? = try db.readTransaction {
            let readStartedAt=Date()
            // Re-evaluate CURRENT rows using the exact accepted UI clock, not historical reconstruction.
            let current=try worldSnapshot(at:expectedWorld.asOf)
            guard try Self.captureObjectsEqual(JSONCodec.encode(current),JSONCodec.encode(expectedWorld)) else {return nil}
            try Self.privateCaptureFile(Data(request.worldJSON.utf8),at:staging.appendingPathComponent("world.json"))
            try Self.privateCaptureFile(Data(request.projectionJSON.utf8),at:staging.appendingPathComponent("projection.json"))
            let database=staging.appendingPathComponent("core.sqlite")
            try Self.privateCaptureFile(Data(),at:database)
            try db.backup(to:database)
            let handle=try FileHandle(forWritingTo:database);defer {try? handle.close()};try handle.synchronize()
            let intents=Int(try db.rows("SELECT count(*) AS n FROM provider_invocations WHERE dispatch_json IS NOT NULL").first?["n"] ?? "0") ?? 0
            let unknown=Int(try db.rows("SELECT count(*) AS n FROM provider_invocations WHERE dispatch_json IS NULL").first?["n"] ?? "0") ?? 0
            let bytes=(try FileManager.default.attributesOfItem(atPath:database.path)[.size] as? NSNumber)?.int64Value ?? 0
            return QualityCaptureManifest(schemaVersion:1,requestSHA256:requestHash,databaseSHA256:try Self.captureFileHash(database),databaseBytes:bytes,receipt:receipt,
                pipelineCoverage:"unknown",coverageReason:"Prospective records do not establish complete pre-cutover, upstream or unsupported-provider history. Label and export scoped samples before evaluating.",
                projectionValidation:"Exact current world matched; identity/version-bound projection from shared UI ranking. Not a historical or viewport capture.",dispatchIntentCount:intents,undispatchedAuditCount:unknown,databaseReadStartedAt:readStartedAt,databaseReadFinishedAt:Date())
        }
        guard let result else {return stale()}
        try Self.privateCaptureFile(try JSONCodec.encode(result),at:staging.appendingPathComponent("capture.json"))
        try Self.syncCaptureDirectory(staging)
        try fm.moveItem(at:staging,to:final)
        try Self.syncCaptureDirectory(directory)
        return receipt
    }

    private func validateQualityProjection(_ request:QualityCaptureRequest,world:WorldSnapshot)throws {
        guard let p=try JSONSerialization.jsonObject(with:Data(request.projectionJSON.utf8)) as? [String:Any],
              p["schemaVersion"] as? Int==1,p["kind"] as? String=="current-ui-task-projection",p["currentOnly"] as? Bool==true,
              p["scope"] as? String=="unfiltered-task-tabs",p["visibility"] as? String=="tab-membership-not-viewport",
              p["capturedAt"] as? String==request.capturedAt,
              let w=p["world"] as? [String:Any],w["revision"] as? Int64==world.revision,
              let asOf=w["asOf"] as? String,let projectedDate=Self.captureDate(asOf),abs(projectedDate.timeIntervalSince(world.asOf))<0.0011,
              let hash=w["hash"] as? [String:Any],hash["algorithm"] as? String=="SHA-256",hash["value"] as? String==request.worldSHA256,
              let surfaces=p["surfaces"] as? [String:Any],Set(surfaces.keys)==Set(["needsYou","waiting","later"]),
              let top=p["topTenNeedsYou"] as? [[String:Any]],let needs=surfaces["needsYou"] as? [[String:Any]],
              NSArray(array:top).isEqual(to:Array(needs.prefix(10))) else {throw MapleError.invalid("Projection does not match its captured world.")}
        let taskVersions=Dictionary(uniqueKeysWithValues:world.tasks.map{("task:"+$0.id,$0.version)})
        let sourceVersions=Dictionary(uniqueKeysWithValues:world.suggestions.map{("source:"+$0.id,$0.version)})
        let versions=taskVersions.merging(sourceVersions){a,_ in a}
        for key in ["needsYou","waiting","later"] {
            guard let rows=surfaces[key] as? [[String:Any]],rows.count<=50000 else {throw MapleError.invalid("Invalid projection surface.")}
            var ranked=Set<String>(),rendered=Set<String>()
            for row in rows {
                guard let node=row["rankedNode"] as? [String:Any],let id=node["id"] as? String,let version=node["version"] as? Int,versions[id]==version,
                      let render=row["renderedRow"] as? [String:Any],let rid=render["id"] as? String,let rv=render["version"] as? Int,versions[rid]==rv,
                      ranked.insert(id).inserted,rendered.insert(rid).inserted,let evidence=row["sourceEventIDs"] as? [String],evidence.count<=50000,
                      evidence.allSatisfy({!$0.isEmpty && $0.utf8.count<=1024}) else {throw MapleError.invalid("Projection identity or version is invalid.")}
                if id != rid {
                    guard id.hasPrefix("task:"),world.suggestions.contains(where:{"source:"+$0.id==rid && "task:"+($0.linkedTaskID ?? "")==id}) else {throw MapleError.invalid("Rendered task identity does not match the captured world.")}
                }
            }
        }
    }
    static func captureHash(_ data:Data)->String {SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined()}
    static func captureObjectsEqual(_ lhs:Data,_ rhs:Data)throws->Bool {
        guard let left=try JSONSerialization.jsonObject(with:lhs) as? NSDictionary,let right=try JSONSerialization.jsonObject(with:rhs) as? NSDictionary else {return false}
        return left.isEqual(right)
    }
    static func captureDate(_ value:String)->Date? {
        let f=ISO8601DateFormatter();f.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        if let date=f.date(from:value){return date};f.formatOptions=[.withInternetDateTime];return f.date(from:value)
    }
    private static func requireRegularCaptureDirectory(_ url:URL)throws {
        let type=try FileManager.default.attributesOfItem(atPath:url.path)[.type] as? FileAttributeType
        guard type == .typeDirectory else {throw MapleError.invalid("Capture location is not a private directory.")}
    }
    private static func privateCaptureDirectory(_ url:URL)throws {
        try FileManager.default.createDirectory(at:url,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        try requireRegularCaptureDirectory(url)
        try FileManager.default.setAttributes([.posixPermissions:0o700],ofItemAtPath:url.path)
    }
    private static func privateCaptureFile(_ data:Data,at url:URL)throws {
        guard FileManager.default.createFile(atPath:url.path,contents:nil,attributes:[.posixPermissions:0o600]) else {throw MapleError.invalid("Could not create private capture file.")}
        let handle=try FileHandle(forWritingTo:url);defer {try? handle.close()};try handle.write(contentsOf:data);try handle.synchronize()
    }
    private static func captureFileHash(_ url:URL)throws->String {
        guard try FileManager.default.attributesOfItem(atPath:url.path)[.type] as? FileAttributeType == .typeRegular else {throw MapleError.invalid("Capture file is unavailable.")}
        let handle=try FileHandle(forReadingFrom:url);defer {try? handle.close()};var hash=SHA256()
        while let data=try handle.read(upToCount:1024*1024),!data.isEmpty {hash.update(data:data)}
        return hash.finalize().map{String(format:"%02x",$0)}.joined()
    }
    private static func syncCaptureDirectory(_ url:URL)throws {
        let fd=open(url.path,O_RDONLY);guard fd>=0 else {throw MapleError.invalid("Could not synchronize capture directory.")};defer {close(fd)}
        guard fsync(fd)==0 else {throw MapleError.invalid("Could not synchronize capture directory.")}
    }
}
