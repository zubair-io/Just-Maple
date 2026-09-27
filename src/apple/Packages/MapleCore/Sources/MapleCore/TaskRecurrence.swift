import Foundation

public enum OccurrenceCalendar {
    /// Foundation Calendar is the recurrence engine. Gaps advance preserving minutes;
    /// repeated wall times choose the first occurrence. The series zone never follows travel.
    public static func dates(_ series:TaskSeries, through:Date, after:Date = .distantPast, limit:Int = 400) throws -> [(String,Date)] {
        guard ["daily","weekly"].contains(series.frequency),let zone=TimeZone(identifier:series.timeZone) else {throw MapleError.invalid("Use a daily or weekly series in an IANA time zone.")}
        var start=DueSpec();start.date=series.startDate;start.timeZone=series.timeZone
        var day=try start.boundary();let time=series.localTime.split(separator:":").compactMap{Int($0)}
        guard time.count==2,(0...23).contains(time[0]),(0...59).contains(time[1]) else {throw MapleError.invalid("Use an HH:mm local recurrence time.")}
        var calendar=Calendar(identifier:.gregorian);calendar.timeZone=zone
        var end=through
        if let date=series.endDate {var due=start;due.date=date;end=min(end,try due.boundary(endOfDay:true))}
        var result:[(String,Date)]=[]
        var iterations=0
        while day<=end && iterations<4000 {
            iterations+=1
            let local=calendar.dateComponents([.year,.month,.day],from:day)
            let key=String(format:"%04d-%02d-%02d",local.year!,local.month!,local.day!)+"T"+series.localTime+"["+series.timeZone+"]"
            guard let instant=calendar.nextDate(after:day.addingTimeInterval(-1),matching:DateComponents(hour:time[0],minute:time[1]),matchingPolicy:.nextTimePreservingSmallerComponents,repeatedTimePolicy:.first,direction:.forward) else {throw MapleError.invalid("Cannot resolve this local occurrence.")}
            if instant<=end && instant>=after {result.append((key,instant))}
            guard result.count<=limit else {throw MapleError.invalid("The series would create too many occurrences. Use a more recent start date.")}
            day=calendar.date(byAdding:.day,value:series.frequency=="daily" ? 1:7,to:day)!
        }
        return result
    }
}
extension KnowledgeStore {
    public func saveSeries(_ input:TaskSeries, expectedVersion:Int, requestID:String, at:Date = Date()) throws -> TaskSeries {
        try command(requestID,payload:JSONCodec.string(input)+String(expectedVersion)) {
            try validateTask(input.template)
            let old=try record("task_series",id:input.id,as:TaskSeries.self)
            guard (old?.version ?? 0)==expectedVersion else {throw MapleError.invalid("This recurring task changed. Reload before saving.")}
            if let old {guard old.frequency==input.frequency,old.startDate==input.startDate,old.localTime==input.localTime,old.timeZone==input.timeZone else {throw MapleError.invalid("Keep the original recurrence schedule. Pause this series and create a new schedule to change its time.")}}
            var series=input;series.version=expectedVersion+1
            _ = try OccurrenceCalendar.dates(series,through:at.addingTimeInterval(31*86400),after:at.addingTimeInterval(-31*86400))
            try db.execute("INSERT INTO task_series VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,json=excluded.json",[series.id,String(series.version),try JSONCodec.string(series)])
            if old != nil {
                for current in try tasks() where current.seriesID==series.id && !current.status.terminal && (current.due?.instant ?? .distantPast)>at {
                    // Explicit this-and-future edits keep per-occurrence timing and identity.
                    var updated=series.template;updated.id=current.id;updated.seriesID=current.seriesID;updated.occurrenceKey=current.occurrenceKey;updated.due=current.due
                    updated.status=current.status;updated.version=current.version+1;updated.createdAt=current.createdAt;updated.updatedAt=at
                    try writeTask(updated,at:at)
                    try history(subjects:[updated.id]+updated.activityIDs,type:"task.series_updated",before:current,after:updated,command:requestID,at:at)
                }
            }
            try history(subjects:[series.id],type:old == nil ? "series.created":"series.updated",before:old,after:series,command:requestID,at:at)
            if !series.paused {try materialize(series,through:at.addingTimeInterval(31*86400),at:at)}
            return series
        }
    }
    func materialize(_ series:TaskSeries, through:Date, at:Date) throws {
        for (key,date) in try OccurrenceCalendar.dates(series,through:through,after:at.addingTimeInterval(-31*86400)) {
            guard try db.rows("SELECT task_id FROM task_occurrences WHERE series_id=? AND occurrence_key=?",[series.id,key]).isEmpty else {continue}
            var task=series.template;task.id=UUID().uuidString;task.seriesID=series.id;task.occurrenceKey=key;task.status = .open;task.completedAt=nil;task.version=1;task.createdAt=at;task.updatedAt=at
            var due=DueSpec();due.kind = .instant;due.instant=date;due.timeZone=series.timeZone;task.due=due
            try writeTask(task,at:at)
            try db.execute("INSERT INTO task_occurrences VALUES (?,?,?)",[series.id,key,task.id])
            try history(subjects:[task.id,series.id]+task.activityIDs,type:"task.occurrence_created",before:Optional<LifeTask>.none,after:task,command:series.id+key,at:at,actor:"recurrence")
        }
    }
    public func materializeOccurrences(at:Date = Date()) throws {
        try db.transaction {for series in try records("task_series",as:TaskSeries.self) where !series.paused {try materialize(series,through:at.addingTimeInterval(31*86400),at:at)};try materializeWaitingFollowUpsInTransaction(at:at)}
    }
}
