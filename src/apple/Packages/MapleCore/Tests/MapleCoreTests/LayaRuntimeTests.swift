import Foundation
import Testing

@testable import MapleCore

struct LayaRuntimeTests {
  struct Case: Decodable {
    let text: String
    let ids: [Int32]
  }
  struct Sequence: Decodable {
    struct Option: Decodable {
      let label: String
      let criterion: String?
    }
    let type: String
    let instructions: String
    let options: [Option]
    let state: String
    let ids: [Int32]
    let markers: [Int]
  }
  struct Fixture: Decodable {
    let cases: [Case]
    let sequences: [Sequence]
  }
  func fixture() throws -> (LayaTokenizer, Fixture) {
    let object = try JSONSerialization.jsonObject(with: LayaTokenizerFixture.data) as! [String: Any]
    return (
      try LayaTokenizer(data: JSONSerialization.data(withJSONObject: object["tokenizer"]!)),
      try JSONDecoder().decode(Fixture.self, from: LayaTokenizerFixture.data)
    )
  }
  @Test func nativeTokenizerMatchesPinnedHuggingFaceAcrossUnicodeWhitespaceAndSpecials() throws {
    let (tokenizer, fixture) = try fixture()
    for item in fixture.cases {
      do {
        #expect(
          try tokenizer.encode(item.text) == item.ids,
          "Token parity mismatch for public fixture: \(item.text)")
      } catch { Issue.record("Public fixture \(item.text): \(error)") }
    }
  }
  @Test func sequenceAndMarkersMatchUpstreamForEveryQuestionType() throws {
    let (tokenizer, fixture) = try fixture()
    for item in fixture.sequences {
      let question = LayaQuestion(
        type: item.type, instructions: item.instructions,
        options: item.options.map { LayaOption(label: $0.label, criterion: $0.criterion) })
      let prepared = try LayaRuntime.prepare(
        tokenizer: tokenizer, state: item.state, question: question)
      #expect(prepared.inputIDs == item.ids)
      #expect(prepared.markerPositions == item.markers)
      #expect(prepared.markerPositions.allSatisfy { prepared.inputIDs[$0] == 50284 })
      #expect(prepared.inputIDs.first == 50281)
      #expect(prepared.inputIDs.last == 50282)
      #expect(prepared.questionType == ["choice": 0, "score": 1, "noul": 2][item.type])
    }
  }
  @Test func capacityFailuresDoNotSilentlyTruncateQuestionOptionsOrSource() throws {
    let (tokenizer, fixture) = try fixture()
    let item = fixture.sequences[0]
    let options = item.options.map { LayaOption(label: $0.label, criterion: $0.criterion) }
    func expectCapacity(_ state: String, _ question: LayaQuestion) throws {
      do {
        _ = try LayaRuntime.prepare(tokenizer: tokenizer, state: state, question: question)
        Issue.record("Expected explicit capacity failure")
      } catch let error as LayaError {
        if case .capacity = error {} else { Issue.record("Unexpected error: \(error)") }
      }
    }
    try expectCapacity(
      String(repeating: "Hello ", count: 600),
      LayaQuestion(type: "choice", instructions: item.instructions, options: options))
    try expectCapacity(
      "Hello",
      LayaQuestion(
        type: "choice", instructions: String(repeating: "Hello ", count: 200), options: options))
    try expectCapacity(
      "Hello",
      LayaQuestion(
        type: "choice", instructions: item.instructions,
        options: [LayaOption(label: "A", criterion: String(repeating: "Hello ", count: 60))]))
    try expectCapacity(
      "Hello",
      LayaQuestion(
        type: "choice", instructions: item.instructions,
        options: (0..<33).map { LayaOption(label: String($0)) }))
  }
  @Test func temperatureSoftmaxUsesOnlyRealOptionsAndRejectsInvalidOutputs() throws {
    let actual = try LayaRuntime.calibratedDistribution(logits: [2, 0], temperature: 2)
    #expect(abs(actual[0] - 0.7310585786300049) < 1e-12)
    #expect(abs(actual.reduce(0, +) - 1) < 1e-12)
    #expect(
      try LayaRuntime.calibratedDistribution(logits: [99999, 99999], temperature: 0.1) == [
        0.5, 0.5,
      ])
    #expect(throws: LayaError.self) {
      try LayaRuntime.calibratedDistribution(logits: [.nan, 1], temperature: 1)
    }
    #expect(throws: LayaError.self) {
      try LayaRuntime.calibratedDistribution(logits: [1, 2], temperature: 0)
    }
  }
  @Test func missingAssetsFailWithoutNetworkFallback() throws {
    #expect(throws: LayaError.self) {
      try LayaRuntime(
        modelDirectory: FileManager.default.temporaryDirectory.appendingPathComponent(
          UUID().uuidString))
    }
  }
  @Test(.enabled(if: ProcessInfo.processInfo.environment["MAPLE_LAYA_MODEL_DIR"] != nil))
  func fullPinnedTokenizerAndBundledModelProduceFiniteLocalDistribution() async throws {
    let directory = URL(
      fileURLWithPath: try #require(ProcessInfo.processInfo.environment["MAPLE_LAYA_MODEL_DIR"]))
    let tokenizer = try LayaTokenizer(
      data: Data(contentsOf: directory.appendingPathComponent("tokenizer/tokenizer.json")))
    let fixture = try self.fixture().1
    for item in fixture.cases { #expect(try tokenizer.encode(item.text) == item.ids) }
    let runtime = try LayaRuntime(modelDirectory: directory)
    let item = fixture.sequences[0]
    let question = LayaQuestion(
      type: item.type, instructions: item.instructions,
      options: item.options.map { LayaOption(label: $0.label, criterion: $0.criterion) })
    let prepared = try await runtime.prepare(state: item.state, question: question)
    #expect(prepared.inputIDs == item.ids)
    let answer = try await runtime.predict(state: item.state, question: question)
    #expect(answer.distribution.count == 3)
    #expect(answer.distribution.allSatisfy { $0.isFinite && $0 >= 0 && $0 <= 1 })
    #expect(abs(answer.distribution.reduce(0, +) - 1) < 1e-10)
    #expect(answer.temperature == 1.7601518630981445)
    #expect(answer.tokenCount == item.ids.count)
    #expect(answer.latency > 0)
  }
  struct Verification: Decodable {
    let name: String
    let state: String
    let type: String
    let instructions: String
    let options: [Sequence.Option]
    let tokens: Int
    let argmax: Int
    let temperature: Double
  }
  @Test(.enabled(if: ProcessInfo.processInfo.environment["MAPLE_LAYA_MODEL_DIR"] != nil))
  func nativeModelMatchesAllSixteenPinnedUpstreamVerificationFixtures() async throws {
    let directory = URL(
      fileURLWithPath: try #require(ProcessInfo.processInfo.environment["MAPLE_LAYA_MODEL_DIR"]))
    let runtime = try LayaRuntime(modelDirectory: directory)
    let cases = try JSONDecoder().decode(
      [Verification].self, from: LayaTokenizerFixture.verificationData)
    #expect(cases.count == 16)
    for item in cases {
      let answer = try await runtime.predict(
        state: item.state,
        question: LayaQuestion(
          type: item.type, instructions: item.instructions,
          options: item.options.map { LayaOption(label: $0.label, criterion: $0.criterion) }))
      #expect(answer.tokenCount == item.tokens, "Token count: \(item.name)")
      #expect(answer.temperature == item.temperature, "Temperature: \(item.name)")
      let argmax = try #require(
        answer.distribution.indices.max(by: { answer.distribution[$0] < answer.distribution[$1] }))
      #expect(argmax == item.argmax, "Published reference argmax: \(item.name)")
    }
  }

}
