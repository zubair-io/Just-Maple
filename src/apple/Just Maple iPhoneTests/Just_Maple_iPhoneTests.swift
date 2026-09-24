import Foundation
import Testing
import MapleCompanionTransport
@testable import Just_Maple_iPhone

@MainActor struct Just_Maple_iPhoneTests {
    @Test func capturesPersistAndDuplicateRequestsAreIdempotent()throws {
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {try? FileManager.default.removeItem(at:directory)}
        let store=try CompanionStore(directory:directory),id=UUID().uuidString
        try store.capture(id:id,text:"Synthetic offline note")
        try store.capture(id:id,text:"Synthetic offline note")
        #expect(store.snapshot.captures.count==1)
        #expect(throws:CompanionError.self){try store.capture(id:id,text:"Different text")}
        let reopened=try CompanionStore(directory:directory)
        #expect(reopened.snapshot.deviceID==store.snapshot.deviceID)
        #expect(reopened.snapshot.captures==store.snapshot.captures)
    }
    @Test func invalidRequestsAndCorruptStorageDoNotReplaceNotes()throws {
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {try? FileManager.default.removeItem(at:directory)}
        let store=try CompanionStore(directory:directory)
        #expect(throws:CompanionError.self){try store.capture(id:"bad",text:"hello")}
        #expect(throws:CompanionError.self){try store.capture(id:UUID().uuidString,text:String(repeating:"a",count:16_001))}
        #expect(store.snapshot.captures.isEmpty)
        let file=directory.appendingPathComponent("captures.json")
        try Data("corrupt-fixture".utf8).write(to:file)
        #expect(throws:CompanionError.self){_ = try CompanionStore(directory:directory)}
        #expect(try String(contentsOf:file,encoding:.utf8)=="corrupt-fixture")
    }
    @Test func receiptsPersistOnlyForSentCapturesAndMatchingDevice()throws {
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer{try? FileManager.default.removeItem(at:directory)}
        let store=try CompanionStore(directory:directory),id=UUID(),other=UUID()
        try store.capture(id:id.uuidString,text:"Synthetic sync capture")
        let device=try #require(UUID(uuidString:store.snapshot.deviceID))
        #expect(throws:CompanionError.self){try store.accept(.init(deviceID:device,receivedIDs:[other]),sentIDs:[id])}
        #expect(throws:CompanionError.self){try store.accept(.init(deviceID:other,receivedIDs:[id]),sentIDs:[id])}
        #expect(store.pending.count==1)
        try store.accept(.init(deviceID:device,receivedIDs:[id],tasks:[.init(id:"task",title:"Synthetic task",status:"open",activities:["Synthetic activity"],due:nil)]),sentIDs:[id])
        let reopened=try CompanionStore(directory:directory)
        #expect(reopened.pending.isEmpty)
        #expect(reopened.snapshot.mac?.tasks.first?.title=="Synthetic task")
        try reopened.clearMac()
        #expect(reopened.snapshot.mac==nil)
        #expect(reopened.pending.isEmpty)
    }
    @Test func bridgeOnlyAllowsBundledMainPageAndKnownCommands()throws {
        #expect(CompanionBridge.isBundledPage(URL(string:"app://localhost/#/capture")))
        for url in ["https://localhost/","app://localhost/evil","app://other/","app://localhost/?other=1","app://user@localhost/"] {
            #expect(!CompanionBridge.isBundledPage(URL(string:url)))
        }
        #expect(throws:Error.self){try CompanionBridge().perform("sendReply",body:[:])}
        let web=try #require(Bundle.main.url(forResource:"index",withExtension:"html",subdirectory:"browser"))
        #expect(try String(contentsOf:web,encoding:.utf8).contains("maple-root"))
    }
}
