import CoreML
import CryptoKit
import Foundation

public enum LayaError: Error, LocalizedError, Sendable, Equatable {
  case assets(String)
  case capacity(String)
  case question(String)
  case inference(String)
  public var errorDescription: String? {
    switch self {
    case .assets(let text), .capacity(let text), .question(let text), .inference(let text):
      return text
    }
  }
}
public struct LayaOption: Sendable, Equatable {
  public let label: String
  public let criterion: String?
  public init(label: String, criterion: String? = nil) {
    self.label = label
    self.criterion = criterion
  }
}
public struct LayaQuestion: Sendable, Equatable {
  public let type: String
  public let instructions: String
  public let options: [LayaOption]
  public init(type: String, instructions: String, options: [LayaOption] = []) {
    self.type = type
    self.instructions = instructions
    self.options = options
  }
}
public struct LayaAnswer: Sendable, Equatable {
  public let distribution: [Double]
  public let options: [String]
  public let tokenCount: Int
  /// Wall-clock seconds for input preparation and model prediction, including first lazy load.
  public let latency: Double
  public let temperature: Double
  public let logits: [Double]
  public init(
    distribution: [Double], options: [String], tokenCount: Int, latency: Double,
    temperature: Double = 1, logits: [Double] = []
  ) {
    self.distribution = distribution
    self.options = options
    self.tokenCount = tokenCount
    self.latency = latency
    self.temperature = temperature
    self.logits = logits
  }
}
public struct LayaPreparedInput: Sendable, Equatable {
  public let inputIDs: [Int32]
  public let markerPositions: [Int]
  public let questionType: Int
  public let options: [String]
  public var tokenCount: Int { inputIDs.count }
}

/// Fixed L512 English inference. Actor isolation serializes Core ML work off the main actor.
public actor LayaRuntime {
  public static let modelRevision = "78c0b0e5054eb5804c72080016227d4f3b0bd08d"
  public static let modelName = "laya_english_fp16_L512_options32"
  public static let maximumTokens = 512
  public static let headMaximumTokens = 192
  private let directory: URL
  private let tokenizer: LayaTokenizer
  private let temperatures: [Double]
  private let optionTemperatures: [String: Double]
  private var model: MLModel?

  public init(modelDirectory: URL) throws {
    self.directory = modelDirectory
    let tokenizerData = try Self.asset(
      modelDirectory.appendingPathComponent("tokenizer/tokenizer.json"),
      sha256: "6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30")
    self.tokenizer = try LayaTokenizer(data: tokenizerData)
    let configuration = try Self.asset(
      modelDirectory.appendingPathComponent("rl_agent_config.json"),
      sha256: "ae287b56bbcf5f8c4f4541ae9dfd00c914c4c48b940b8398c3058af37ba92bbd")
    guard let object = try JSONSerialization.jsonObject(with: configuration) as? [String: Any],
      object["max_len"] as? Int == 512, object["head_max_len"] as? Int == 192,
      let temperatures = object["temperature"] as? [Double], temperatures.count == 3,
      let buckets = object["temperature_by_options"] as? [String: Double],
      (temperatures + Array(buckets.values)).allSatisfy({ $0.isFinite && $0 > 0 })
    else { throw LayaError.assets("Unsupported Laya calibration configuration.") }
    self.temperatures = temperatures
    self.optionTemperatures = buckets
  }
  private static func asset(_ url: URL, sha256: String) throws -> Data {
    guard let data = try? Data(contentsOf: url),
      SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == sha256
    else {
      throw LayaError.assets(
        "The bundled Laya tokenizer or calibration assets are missing or do not match the pinned model."
      )
    }
    return data
  }
  public func load() throws { _ = try loadedModel() }
  public func prepare(state: String, question: LayaQuestion) throws -> LayaPreparedInput {
    try Self.prepare(tokenizer: tokenizer, state: state, question: question)
  }
  public func tokenCount(_ text: String) throws -> Int { try tokenizer.encode(text).count }

  static func prepare(tokenizer: LayaTokenizer, state: String, question: LayaQuestion) throws
    -> LayaPreparedInput
  {
    guard let type = ["choice": 0, "score": 1, "noul": 2][question.type],
      !question.instructions.isEmpty
    else {
      throw LayaError.question("Choose a supported Laya question type and nonempty instructions.")
    }
    var options = question.options
    if question.type == "noul" {
      if options.isEmpty { options = [LayaOption(label: "false"), LayaOption(label: "true")] }
      guard options.count == 2, Set(options.map(\.label)) == ["false", "true"] else {
        throw LayaError.question("Noul criteria must contain exactly false and true.")
      }
      options = [options.first { $0.label == "false" }!, options.first { $0.label == "true" }!]
    }
    guard !options.isEmpty, options.count <= 32, options.allSatisfy({ !$0.label.isEmpty }),
      Set(options.map(\.label)).count == options.count
    else { throw LayaError.capacity("Laya requires 1–32 distinct nonempty option labels.") }
    func sanitize(_ text: String) -> String { text.replacingOccurrences(of: "[MASK]", with: " ") }
    let rendered = options.enumerated().map { index, option -> String in
      let criterion = option.criterion.flatMap { $0.isEmpty ? nil : $0 }
      if question.type == "score" { return "level \(index): " + (criterion ?? option.label) }
      if question.type == "noul" {
        return option.label + ": "
          + (criterion
            ?? (index == 0 ? "no, the statement does not hold" : "yes, the statement holds"))
      }
      return criterion.map { option.label + ": " + $0 } ?? option.label
    }
    let head = try tokenizer.encode(
      "\(question.type) question: " + sanitize(question.instructions), maximumTokens: 192)
    let spans = try rendered.map {
      try [tokenizer.maskTokenID] + tokenizer.encode(" " + sanitize($0), maximumTokens: 48)
    }
    var budget = 192 - spans.reduce(0) { $0 + $1.count }
    if budget < 16 {
      let per = max(4, (192 - 16) / spans.count)
      guard spans.allSatisfy({ $0.count <= per }) else {
        throw LayaError.capacity(
          "Options exceed Laya's 192-token question budget; shorten their descriptions. Nothing was truncated."
        )
      }
      budget = 192 - spans.reduce(0) { $0 + $1.count }
    }
    guard head.count <= max(8, budget) else {
      throw LayaError.capacity(
        "Instructions exceed Laya's question budget; shorten the question. Nothing was truncated.")
    }
    var ids = [tokenizer.clsTokenID] + head + [tokenizer.sepTokenID]
    var markers: [Int] = []
    for span in spans {
      markers.append(ids.count)
      ids += span
    }
    ids.append(tokenizer.sepTokenID)
    let room = 512 - ids.count - 1
    guard room >= 0 else {
      throw LayaError.capacity("Laya question exceeds its 512-token model capacity.")
    }
    ids += try tokenizer.encode(sanitize(state), maximumTokens: room)
    ids.append(tokenizer.sepTokenID)
    return LayaPreparedInput(
      inputIDs: ids, markerPositions: markers, questionType: type, options: options.map(\.label))
  }

  public func predict(state: String, question: LayaQuestion) async throws -> LayaAnswer {
    try Task.checkCancellation()
    let started = ContinuousClock.now
    let prepared = try prepare(state: state, question: question)
    let model = try loadedModel()
    let inputIDs = try MLMultiArray(shape: [1, 512], dataType: .int32)
    let attention = try MLMultiArray(shape: [1, 512], dataType: .int32)
    let markers = try MLMultiArray(shape: [1, 32, 512], dataType: .float32)
    let type = try MLMultiArray(shape: [1, 3], dataType: .float32)
    for index in 0..<512 {
      inputIDs[index] = NSNumber(
        value: index < prepared.tokenCount ? prepared.inputIDs[index] : tokenizer.padTokenID)
      attention[index] = NSNumber(value: index < prepared.tokenCount ? 1 : 0)
    }
    for index in 0..<markers.count { markers[index] = 0 }
    for (index, position) in prepared.markerPositions.enumerated() {
      markers[index * 512 + position] = 1
    }
    for index in 0..<3 { type[index] = NSNumber(value: index == prepared.questionType ? 1 : 0) }
    let input = try MLDictionaryFeatureProvider(dictionary: [
      "input_ids": MLFeatureValue(multiArray: inputIDs),
      "attention_mask": MLFeatureValue(multiArray: attention),
      "marker_map": MLFeatureValue(multiArray: markers),
      "question_type": MLFeatureValue(multiArray: type),
    ])
    try Task.checkCancellation()
    let prediction: MLFeatureProvider
    do { prediction = try synchronousPrediction(model, input: input) } catch {
      throw LayaError.inference("Local Laya inference failed. The classification remains pending.")
    }
    try Task.checkCancellation()
    guard let logits = prediction.featureValue(for: "logits")?.multiArrayValue, logits.count == 32
    else { throw LayaError.inference("Laya returned an unsupported output shape.") }
    let count = prepared.options.count
    let bucket = count <= 2 ? "2" : count <= 5 ? "3-5" : count <= 10 ? "6-10" : "11+"
    let temperature =
      optionTemperatures[question.type + ":" + bucket] ?? temperatures[prepared.questionType]
    let values = (0..<count).map { logits[$0].doubleValue }
    let probabilities = try Self.calibratedDistribution(logits: values, temperature: temperature)
    let elapsed = started.duration(to: .now).components
    return LayaAnswer(
      distribution: probabilities, options: prepared.options, tokenCount: prepared.tokenCount,
      latency: Double(elapsed.seconds) + Double(elapsed.attoseconds) / 1e18,
      temperature: temperature, logits: values)
  }
  private func synchronousPrediction(_ model: MLModel, input: MLFeatureProvider) throws
    -> MLFeatureProvider
  { try model.prediction(from: input) }
  static func calibratedDistribution(logits: [Double], temperature: Double) throws -> [Double] {
    guard !logits.isEmpty, logits.allSatisfy(\.isFinite), temperature.isFinite, temperature > 0
    else {
      throw LayaError.inference("Laya produced invalid scores; the classification remains pending.")
    }
    let scaled = logits.map { $0 / temperature }
    let maximum = scaled.max()!
    let weights = scaled.map { exp($0 - maximum) }
    let sum = weights.reduce(0, +)
    guard sum.isFinite, sum > 0 else {
      throw LayaError.inference("Laya produced invalid probabilities.")
    }
    return weights.map { $0 / sum }
  }
  private func loadedModel() throws -> MLModel {
    if let model { return model }
    let compiled = directory.appendingPathComponent(Self.modelName + ".mlmodelc")
    let package = directory.appendingPathComponent(Self.modelName + ".mlpackage")
    let url: URL
    if FileManager.default.fileExists(atPath: compiled.path) {
      url = compiled
    } else if FileManager.default.fileExists(atPath: package.path) {
      do { url = try MLModel.compileModel(at: package) } catch {
        throw LayaError.assets("The bundled Laya model could not be compiled.")
      }
    } else {
      throw LayaError.assets("The bundled Laya L512 model is missing.")
    }
    let configuration = MLModelConfiguration()
    configuration.computeUnits = .all
    do {
      let loaded = try MLModel(contentsOf: url, configuration: configuration)
      let descriptions = loaded.modelDescription.inputDescriptionsByName
      let expected: [String: ([Int], MLMultiArrayDataType)] = [
        "input_ids": ([1, 512], .int32), "attention_mask": ([1, 512], .int32),
        "marker_map": ([1, 32, 512], .float32), "question_type": ([1, 3], .float32),
      ]
      for (name, (shape, type)) in expected {
        guard let constraint = descriptions[name]?.multiArrayConstraint,
          constraint.shape.map(\.intValue) == shape, constraint.dataType == type
        else {
          throw LayaError.assets("Bundled Laya input schema does not match the pinned L512 export.")
        }
      }
      self.model = loaded
      return loaded
    } catch let error as LayaError { throw error } catch {
      throw LayaError.assets("The bundled Laya model could not be loaded.")
    }
  }
}
