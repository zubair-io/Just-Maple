import Foundation
import MapleCore
import MapleCompanionTransport

/// Privacy-limited companion projection. Keep ordering aligned with web/world/task-ranking.ts.
@MainActor
enum CompanionSyncProjection {
    private struct Entry {
        var id: String
        var task: LifeTask
        var suggestion: TaskSuggestion?
        var rank = 5
        var when = Double.infinity
    }

    static func make(world: WorldSnapshot, deviceID: UUID, receivedIDs: [UUID], people: [PersonSummary] = [], displayName: String? = nil) -> SyncResponse {
        var entries = world.tasks.map { task in
            Entry(id: "task:" + task.id, task: task, suggestion: world.suggestions.first { $0.reviewStatus == "pending" && $0.linkedTaskID == task.id })
        }
        entries += world.suggestions.filter { suggestion in
            suggestion.reviewStatus == "pending" && !world.tasks.contains { $0.id == suggestion.linkedTaskID }
        }.map { Entry(id: "source:" + $0.id, task: $0.candidate, suggestion: $0) }
        let relations = Dictionary(world.taskRelations.map { ($0.duplicateID, $0.primaryID) }, uniquingKeysWith: { first, _ in first })
        func root(_ input: String) -> String {
            var id = input, seen = Set<String>()
            while seen.insert(id).inserted {
                guard let next = relations[id] else { break }
                id = next
            }
            return id
        }
        let existing = Set(entries.map(\.id))
        let ranked = entries.filter { root($0.id) == $0.id || !existing.contains(root($0.id)) }.map { original in
            var entry = original
            let members = entries.filter { $0.id == entry.id || root($0.id) == entry.id }
            // As on desktop, only detected roots inherit a missing deadline from their aliases.
            if entry.task.due == nil, entry.id.hasPrefix("source:") {
                entry.task.due = members.compactMap { $0.task.due }.min { instant($0, endOfDay: true) < instant($1, endOfDay: true) }
            }
            var seen = Set<String>()
            var seenEvidence=Set<String>()
            let evidence=world.taskProgress.filter { $0.nodeID == entry.id }.map(\.eventID) + members.flatMap { ($0.suggestion.map { [$0.eventID] } ?? []) + $0.task.evidenceIDs }
            entry.task.evidenceIDs=evidence.filter { !$0.isEmpty && seenEvidence.insert($0).inserted }
            entry.task.activityIDs = members.flatMap { $0.task.activityIDs }.filter { seen.insert($0).inserted }
            let due = instant(entry.task.due, endOfDay: true), scheduled = instant(entry.task.scheduled)
            entry.when = min(due, scheduled)
            let now = world.asOf.timeIntervalSince1970
            if due < now || entry.task.priority == 3 { entry.rank = 0 }
            else if entry.when <= now + 86400 { entry.rank = 1 }
            else if entry.when.isFinite { entry.rank = 2 }
            else if entry.suggestion != nil || entry.task.priority > 0 { entry.rank = 3 }
            if !entry.task.conditions.isEmpty {
                let relevant = entry.task.conditions.allSatisfy { condition in
                    guard let state = world.states.first(where: { $0.subject == condition.subject && $0.property == condition.property }) else { return false }
                    return state.status == "known" && state.value?.lowercased() == condition.value.lowercased()
                }
                if relevant && entry.rank > 3 { entry.rank = 3 }
            }
            if entry.task.status == .waiting && entry.rank >= 3 { entry.rank = 4 }
            if entry.task.status.terminal { entry.rank = 6 }
            return entry
        }.sorted {
            if $0.rank != $1.rank { return $0.rank < $1.rank }
            if $0.when != $1.when { return $0.when < $1.when }
            if $0.task.priority != $1.task.priority { return $0.task.priority > $1.task.priority }
            if $0.task.createdAt != $1.task.createdAt { return $0.task.createdAt < $1.task.createdAt }
            return $0.id.localizedCompare($1.id) == .orderedAscending
        }
        let activityNames = Dictionary(world.activities.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        let visible = ranked.filter { !$0.task.status.terminal }
        let actionable = visible.filter { $0.task.status != .waiting && !($0.task.actionState?.isDeferred(at:world.asOf) ?? false) }
        let waiting = visible.filter { $0.task.status == .waiting }
        // Reserve room for both lists before truncation. Unused slots flow to the other
        // list; grouping also prevents payload-size trimming from evicting Needs you first.
        let later=visible.filter { $0.task.status != .waiting && ($0.task.actionState?.isDeferred(at:world.asOf) ?? false) }
        var chosenLater=Array(later.prefix(5))
        var chosenActions = Array(actionable.prefix(40-chosenLater.count))
        var chosenWaiting = Array(waiting.prefix(10))
        var capacity = 50 - chosenActions.count - chosenWaiting.count - chosenLater.count
        let extraActions = Array(actionable.dropFirst(chosenActions.count).prefix(capacity))
        chosenActions += extraActions; capacity -= extraActions.count
        let extraWaiting=Array(waiting.dropFirst(chosenWaiting.count).prefix(capacity))
        chosenWaiting += extraWaiting;capacity -= extraWaiting.count
        chosenLater += later.dropFirst(chosenLater.count).prefix(capacity)
        let tasks = (chosenActions + chosenWaiting + chosenLater).map { entry in
            var value = SyncTask(id: entry.id.utf8.count <= 1024 ? entry.id : "task-hash:" + ConnectorSourceRecord.identifier(entry.id),
                     title: bounded(entry.task.title, 512), status: entry.task.status.rawValue,
                     activities: Array(entry.task.activityIDs.filter { $0.utf8.count <= 1024 && activityNames[$0] != nil }.prefix(8)).compactMap { activityNames[$0] }.map { bounded($0, 80) },
                     due: entry.task.due.flatMap(dueLabel))
            if let followUp=entry.task.waitingFollowUp {
                value.waitingParentNodeID=followUp.parentNodeID
                value.waitingParentTitle=entries.first(where:{$0.id==followUp.parentNodeID}).map { bounded($0.task.title,512) }
                value.waitingReviewReason=followUp.reason
            }
            value.sourceCount=entry.task.evidenceIDs.count
            value.sourceIDs=Array(entry.task.evidenceIDs.filter { $0.utf8.count<=1024 }.prefix(16))
            value.dueAt=entry.task.due.flatMap { try? $0.boundary(endOfDay:true) }
            value.activityIDs=Array(entry.task.activityIDs.filter { $0.utf8.count <= 1024 && activityNames[$0] != nil }.prefix(8))
            value.version=entry.id.hasPrefix("source:") ? entry.suggestion?.version : entry.task.version
            if value.id != entry.id {value.version=nil}
            value.detail=bounded(entry.task.description,4096)
            value.assignee=bounded(entry.task.assignee,160)
            if let state=entry.task.actionState {
                value.actionState = .init(resurfaceAt:state.resurfaceAt,reviewAt:state.reviewAt,waitingOn:state.waitingOn,
                    lastMutationScope:state.lastMutationScope,lastMutationID:state.lastMutationID,lastAction:state.lastAction,
                    canUndo:state.lastMutationScope==deviceID.uuidString.lowercased() && state.lastAction != "undo")
            }
            return value
        }
        let states = world.states.filter { $0.subject == "person:self" }.prefix(32).map {
            SyncState(property: bounded($0.property, 80), status: bounded($0.status, 32), value: $0.value.map { bounded($0, 512) })
        }
        var response = SyncResponse(deviceID: deviceID, receivedIDs: Array(receivedIDs.prefix(1000)), asOf: world.asOf, tasks: tasks, states: states)
        response.needsYouTotal = actionable.count
        response.waitingTotal = waiting.count
        response.laterTotal = later.count
        response.supportedTaskIntents = SyncTaskIntent.allCases.map(\.rawValue)
        response.displayName = displayName.map { bounded($0, 160) }
        response.activities = world.activities.filter { ($0.lifecycle == .active || $0.lifecycle == .paused) && $0.id.utf8.count <= 1024 }.prefix(32).map { activity in
            SyncActivity(id: activity.id, name: bounded(activity.name, 160), kind: activity.kind.rawValue,
                         lifecycle: activity.lifecycle.rawValue,
                         openTaskCount: ranked.filter { !$0.task.status.terminal && $0.task.activityIDs.contains(activity.id) }.count)
        }
        // Caller supplies the existing pins/recent-interaction ranking, never a full contact list.
        response.people = people.filter { $0.pinned || $0.interactions > 0 }.prefix(12).map {
            SyncPerson(id: bounded($0.id, 1024), name: personName($0.name), pinned: $0.pinned, relationship: bounded($0.relationship, 160))
        }
        // JSON escaping can expand even bounded text. Leave headroom below the 256 KB frame cap.
        while let encoded = try? SyncCodec.encode(response), encoded.count > 240_000 {
            if !response.tasks.isEmpty { response.tasks.removeLast() }
            else if !response.states.isEmpty { response.states.removeLast() }
            else if !response.activities.isEmpty { response.activities.removeLast() }
            else if !response.people.isEmpty { response.people.removeLast() }
            else { break }
        }
        return response
    }

    private static func instant(_ due: DueSpec?, endOfDay: Bool = false) -> Double {
        guard let due, let date = try? due.boundary(endOfDay: endOfDay) else { return .infinity }
        return date.timeIntervalSince1970
    }
    private static func dueLabel(_ due: DueSpec) -> String? {
        guard let date = try? due.boundary(), let zone = TimeZone(identifier: due.timeZone) else { return nil }
        let format = DateFormatter()
        format.locale = .current; format.timeZone = zone; format.dateStyle = .medium
        format.timeStyle = due.kind == .date ? .none : .short
        let suffix = due.kind == .instant ? " (\(zone.identifier))" : ""
        return bounded(format.string(from: date) + suffix, 160)
    }
    private static func personName(_ value: String) -> String {
        var name = value
        if name.contains("@") {
            if let marker = name.firstIndex(of: "<") { name = String(name[..<marker]).trimmingCharacters(in: .whitespacesAndNewlines) }
            if name.isEmpty || name.contains("@") { return "Recent contact" }
        }
        if name.allSatisfy({ $0.isNumber || "+()- .".contains($0) }) { return "Recent contact" }
        return bounded(name, 160)
    }
    private static func bounded(_ text: String, _ bytes: Int) -> String {
        var result = "", count = 0
        for scalar in text.unicodeScalars {
            let length = scalar.utf8.count
            guard count + length <= bytes else { break }
            result.unicodeScalars.append(scalar); count += length
        }
        return result
    }
}
