import Testing
import Foundation
@testable import MapleRecorderKit

struct LLMProviderTests {

    @Test func rawValues() {
        #expect(LLMProvider.appleFoundationModels.rawValue == "apple_foundation_models")
        #expect(LLMProvider.claude.rawValue == "claude")
        #expect(LLMProvider.openai.rawValue == "openai")
        #expect(LLMProvider.none.rawValue == "none")
    }

    @Test func caseIterableReturnsFourCases() {
        #expect(LLMProvider.allCases.count == 4)
        #expect(LLMProvider.allCases.contains(.appleFoundationModels))
        #expect(LLMProvider.allCases.contains(.claude))
        #expect(LLMProvider.allCases.contains(.openai))
        #expect(LLMProvider.allCases.contains(.none))
    }

    @Test func encodingDecoding() throws {
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        for provider in LLMProvider.allCases {
            let data = try encoder.encode(provider)
            let decoded = try decoder.decode(LLMProvider.self, from: data)
            #expect(decoded == provider)
        }
    }
}
