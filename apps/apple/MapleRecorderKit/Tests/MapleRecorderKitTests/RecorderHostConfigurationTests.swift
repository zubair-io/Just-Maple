import Foundation
import Testing
@testable import MapleRecorderKit

struct RecorderHostConfigurationTests {
    @Test func retainsHostedIdentityAndSeparatesLocalHost() {
        #expect(RecorderHostConfiguration.cloudContainer([:]) == "iCloud.com.just.maple.JapaneseMaple")
        #expect(RecorderHostConfiguration.keychainService([:]) == "com.just.maple.JapaneseMaple.recorder")
        let info: [String: Any] = ["MapleRecorderICloudContainer": "iCloud.com.just.maple.Local",
            "MapleRecorderKeychainService": "com.just.maple.Local.recorder", "MapleRecorderLocalDirectory": "JustMapleLocal"]
        #expect(RecorderHostConfiguration.cloudContainer(info) == "iCloud.com.just.maple.Local")
        #expect(RecorderHostConfiguration.keychainService(info) == "com.just.maple.Local.recorder")
        let documents = URL(fileURLWithPath: "/example/Documents")
        #expect(RecorderHostConfiguration.localDocuments(documents, info: [:]) == documents)
        #expect(RecorderHostConfiguration.localDocuments(documents, info: info).lastPathComponent == "JustMapleLocal")
    }
}
