import Foundation

/// The pinned English checkpoint's NFC + byte-level BPE tokenizer. No network or runtime dependencies.
public struct LayaTokenizer: Sendable {
  private struct Pair: Hashable, Sendable {
    let left: String
    let right: String
  }
  private struct Added: Sendable {
    let id: Int32
    let content: String
    let lstrip: Bool
    let rstrip: Bool
    let normalized: Bool
  }
  private let vocabulary: [String: Int32]
  private let ranks: [Pair: Int]
  private let added: [String: Added]
  private let addedPattern: NSRegularExpression
  private let normalizedPattern: NSRegularExpression
  private let pieces: NSRegularExpression
  private let byteCharacters: [String]
  public let clsTokenID: Int32
  public let sepTokenID: Int32
  public let padTokenID: Int32
  public let maskTokenID: Int32

  public init(data: Data) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let model = root["model"] as? [String: Any], model["type"] as? String == "BPE",
      let vocab = model["vocab"] as? [String: Int], let merges = model["merges"] as? [[String]],
      let normalizer = root["normalizer"] as? [String: Any], normalizer["type"] as? String == "NFC",
      let pre = root["pre_tokenizer"] as? [String: Any], pre["type"] as? String == "ByteLevel",
      pre["add_prefix_space"] as? Bool == false, pre["use_regex"] as? Bool == true,
      model["byte_fallback"] as? Bool == false, model["ignore_merges"] as? Bool == false,
      let tokens = root["added_tokens"] as? [[String: Any]]
    else { throw LayaError.assets("Unsupported Laya tokenizer format.") }
    var dictionary: [String: Int32] = [:]
    for (token, id) in vocab {
      guard id >= 0, id <= Int(Int32.max) else {
        throw LayaError.assets("Invalid tokenizer vocabulary.")
      }
      dictionary[token] = Int32(id)
    }
    var additions: [String: Added] = [:]
    for token in tokens {
      guard let text = token["content"] as? String, !text.isEmpty, let id = token["id"] as? Int,
        id >= 0, id <= Int(Int32.max), token["single_word"] as? Bool == false
      else { throw LayaError.assets("Unsupported added tokenizer token.") }
      additions[text] = Added(
        id: Int32(id), content: text, lstrip: token["lstrip"] as? Bool ?? false,
        rstrip: token["rstrip"] as? Bool ?? false, normalized: token["normalized"] as? Bool ?? false
      )
    }
    guard let cls = additions["[CLS]"], let sep = additions["[SEP]"], let pad = additions["[PAD]"],
      let mask = additions["[MASK]"]
    else { throw LayaError.assets("Missing Laya special tokens.") }
    self.clsTokenID = cls.id
    self.sepTokenID = sep.id
    self.padTokenID = pad.id
    self.maskTokenID = mask.id
    var rank: [Pair: Int] = [:]
    for (index, merge) in merges.enumerated() {
      guard merge.count == 2 else { throw LayaError.assets("Invalid tokenizer merges.") }
      rank[Pair(left: merge[0], right: merge[1])] = index
    }
    self.vocabulary = dictionary
    self.ranks = rank
    self.added = additions
    func pattern(_ normalized: Bool) throws -> NSRegularExpression {
      let alternatives = additions.values.filter { $0.normalized == normalized }.map(\.content)
        .sorted { $0.utf8.count == $1.utf8.count ? $0 < $1 : $0.utf8.count > $1.utf8.count }.map {
          NSRegularExpression.escapedPattern(for: $0)
        }.joined(separator: "|")
      return try NSRegularExpression(pattern: alternatives.isEmpty ? "(?!)" : alternatives)
    }
    self.addedPattern = try pattern(false)
    self.normalizedPattern = try pattern(true)
    self.pieces = try NSRegularExpression(
      pattern: #"'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+"#)
    let direct = Set(Array(33...126) + Array(161...172) + Array(174...255))
    var next = 256
    var characters: [String] = []
    for byte in 0...255 {
      if direct.contains(byte) {
        characters.append(String(UnicodeScalar(byte)!))
      } else {
        characters.append(String(UnicodeScalar(next)!))
        next += 1
      }
    }
    self.byteCharacters = characters
  }

  /// Returns token ids without automatic CLS/SEP. Fails explicitly instead of silently truncating.
  public func encode(_ text: String, maximumTokens: Int? = nil) throws -> [Int32] {
    guard text.utf8.count <= 256_000 else {
      throw LayaError.capacity("Input exceeds the tokenizer's 256 KB safety limit.")
    }
    var ids: [Int32] = []
    func checkCapacity() throws {
      if let maximumTokens, ids.count > maximumTokens {
        throw LayaError.capacity("Input exceeds \(maximumTokens) tokens; it was not truncated.")
      }
    }
    func appendPlain(_ value: String) throws {
      let source = value as NSString
      for match in pieces.matches(in: value, range: NSRange(location: 0, length: source.length)) {
        let raw = source.substring(with: match.range)
        ids += try bpe(raw.utf8.map { byteCharacters[Int($0)] })
        try checkCapacity()
      }
    }
    func splitAdded(_ value: String, pattern: NSRegularExpression, plain: (String) throws -> Void)
      throws
    {
      let ns = value as NSString
      var cursor = 0
      for match in pattern.matches(in: value, range: NSRange(location: 0, length: ns.length)) {
        guard let token = added[ns.substring(with: match.range)] else { continue }
        var start = match.range.location
        var end = NSMaxRange(match.range)
        if token.lstrip {
          while start > cursor, let scalar = UnicodeScalar(ns.character(at: start - 1)),
            CharacterSet.whitespacesAndNewlines.contains(scalar)
          { start -= 1 }
        }
        if token.rstrip {
          while end < ns.length, let scalar = UnicodeScalar(ns.character(at: end)),
            CharacterSet.whitespacesAndNewlines.contains(scalar)
          { end += 1 }
        }
        if start < cursor { continue }
        try plain(ns.substring(with: NSRange(location: cursor, length: start - cursor)))
        ids.append(token.id)
        cursor = end
        try checkCapacity()
      }
      try plain(ns.substring(with: NSRange(location: cursor, length: ns.length - cursor)))
    }
    // Non-normalized special tokens (including MASK's whitespace consumption) take
    // precedence over normalized additions such as the checkpoint's multi-space tokens.
    try splitAdded(text, pattern: addedPattern) { value in
      try splitAdded(
        value.precomposedStringWithCanonicalMapping, pattern: normalizedPattern, plain: appendPlain)
    }

    return ids
  }

  private struct Edge {
    let rank: Int
    let left: Int
    let right: Int
    let generation: Int
    let rightGeneration: Int
  }
  /// Ranked merge heap avoids quadratic behavior on long unbroken pasted strings.
  private func bpe(_ initial: [String]) throws -> [Int32] {
    guard !initial.isEmpty else { return [] }
    var text = initial
    var next = initial.indices.map { $0 + 1 }
    var previous = initial.indices.map { $0 - 1 }
    var generation = Array(repeating: 0, count: initial.count)
    var alive = Array(repeating: true, count: initial.count)
    var heap: [Edge] = []
    next[next.count - 1] = -1
    func before(_ a: Edge, _ b: Edge) -> Bool {
      a.rank == b.rank ? a.left < b.left : a.rank < b.rank
    }
    func push(_ edge: Edge) {
      heap.append(edge)
      var index = heap.count - 1
      while index > 0 {
        let parent = (index - 1) / 2
        if !before(heap[index], heap[parent]) { break }
        heap.swapAt(index, parent)
        index = parent
      }
    }
    func pop() -> Edge? {
      guard !heap.isEmpty else { return nil }
      if heap.count == 1 { return heap.removeLast() }
      let result = heap[0]
      heap[0] = heap.removeLast()
      var index = 0
      while 2 * index + 1 < heap.count {
        var child = 2 * index + 1
        if child + 1 < heap.count, before(heap[child + 1], heap[child]) { child += 1 }
        if !before(heap[child], heap[index]) { break }
        heap.swapAt(index, child)
        index = child
      }
      return result
    }
    func schedule(_ left: Int) {
      guard left >= 0, alive[left], next[left] >= 0 else { return }
      let right = next[left]
      if let rank = ranks[Pair(left: text[left], right: text[right])] {
        push(
          Edge(
            rank: rank, left: left, right: right, generation: generation[left],
            rightGeneration: generation[right]))
      }
    }
    for index in initial.indices { schedule(index) }
    while let edge = pop() {
      let left = edge.left
      let right = edge.right
      guard alive[left], alive[right], next[left] == right, generation[left] == edge.generation,
        generation[right] == edge.rightGeneration
      else { continue }
      text[left] += text[right]
      next[left] = next[right]
      generation[left] += 1
      alive[right] = false
      if next[left] >= 0 { previous[next[left]] = left }
      schedule(previous[left])
      schedule(left)
    }
    return try initial.indices.filter { alive[$0] }.map { index in
      guard let id = vocabulary[text[index]] else {
        throw LayaError.assets("Tokenizer produced an unknown vocabulary token.")
      }
      return id
    }
  }
}
