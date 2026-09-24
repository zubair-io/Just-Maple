import { Due, LifeTask, Suggestion, WorldSnapshot, isOpen } from './world.models';
export interface RankedTask {
  id: string; task: LifeTask; suggestion?: Suggestion; reason: string; rank: number; when: number; sourceCount: number;
}
// Resolve date-only boundaries in their declared zone, including DST, never the browser's zone.
export function dueInstant(due?: Due, endOfDay = false): number {
  if (!due) return Infinity;
  if (due.kind === 'instant') return due.instant ?? Infinity;
  const [y,m,d] = due.date.split('-').map(Number);
  const target = Date.UTC(y,m-1,d+(endOfDay ? 1 : 0));
  let value = target;
  const format = new Intl.DateTimeFormat('en-GB', {timeZone:due.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for (let i=0;i<4;i++) {
    const parts=format.formatToParts(new Date(value));
    const n=(type:string)=>Number(parts.find(p=>p.type===type)!.value);
    const represented=Date.UTC(n('year'),n('month')-1,n('day'),n('hour'),n('minute'),n('second'));
    value+=target-represented;
  }
  return value/1000;
}
export function taskRoot(id: string, world: WorldSnapshot): string {
  const seen=new Set<string>();
  while(!seen.has(id)) {seen.add(id);const next=world.taskRelations?.find(r=>r.duplicateID===id)?.primaryID;if(!next)return id;id=next;}
  return id;
}
export function rankTasks(world: WorldSnapshot): RankedTask[] {
  const entries: {id:string;task:LifeTask;suggestion?:Suggestion}[] = world.tasks.map(task=>({id:'task:'+task.id,task,suggestion:world.suggestions.find(s=>s.reviewStatus==='pending' && s.linkedTaskID===task.id)}));
  entries.push(...world.suggestions.filter(s=>s.reviewStatus==='pending' && !world.tasks.some(t=>t.id===s.linkedTaskID)).map(s=>({id:'source:'+s.id,task:s.candidate,suggestion:s})));
  const existing=new Set(entries.map(e=>e.id));
  return entries.filter(e=>taskRoot(e.id,world)===e.id || !existing.has(taskRoot(e.id,world))).map(entry=>{
    const members=entries.filter(e=>e.id===entry.id || taskRoot(e.id,world)===entry.id);
    const sourceIDs=new Set(members.flatMap(e=>e.suggestion?[e.suggestion.eventID]:e.task.evidenceIDs));
    const progress=world.taskProgress?.find(p=>p.nodeID===entry.id);
    if(progress)sourceIDs.add(progress.eventID);
    const supportedDue=members.map(e=>e.task.due).filter((d):d is Due=>!!d).sort((a,b)=>dueInstant(a,true)-dueInstant(b,true))[0];
    entry={...entry,task:{...entry.task,due:entry.task.due ?? (entry.id.startsWith('source:') ? supportedDue : undefined),activityIDs:[...new Set(members.flatMap(e=>e.task.activityIDs))],evidenceIDs:[...sourceIDs]}};
    const {task,suggestion}=entry, now=world.asOf;
    const due=dueInstant(task.due,true), scheduled=dueInstant(task.scheduled);
    const when=Math.min(due,scheduled);
    let rank=5, reason='No deadline set';
    if (due<now) {rank=0;reason='Overdue';}
    else if (task.priority===3) {rank=0;reason='High priority';}
    else if (when<=now+86400) {rank=1;reason=scheduled<=due?'Scheduled within the next day':'Due within the next day';}
    else if (when<Infinity) {rank=2;reason='Upcoming deadline or scheduled time';}
    else if (suggestion) {rank=3;reason=suggestion.linkedTaskID?'Source update to review':'Action found in your source';}
    else if (task.priority>0) {rank=3;reason='Marked as a priority';}
    if (task.conditions.length) {
      const matches=task.conditions.map(c=>world.states.find(s=>s.subject===c.subject&&s.property===c.property));
      const conflict=matches.some((s,i)=>s?.status==='known'&&s.value?.toLowerCase()!==task.conditions[i].value.toLowerCase());
      const known=matches.every(s=>s?.status==='known');
      if (conflict) reason+=' · Current context differs; review responsibility';
      else if (!known) reason+=' · Required context is not confirmed';
      else {reason+=' · Relevant in your current context';if(rank>3)rank=3;}
    }
    if(progress) reason=progress.reason;
    if(task.status==='waiting') {reason+=task.assignee ? ' · Waiting on '+task.assignee : ' · Waiting';if(rank>=3)rank=4;}
    if(!isOpen(task)) {rank=6;reason=task.status==='completed'?'Completed':'Cancelled';}
    const dates=new Set(members.filter(e=>e.task.due).map(e=>dueInstant(e.task.due,true)));
    if(dates.size>1 && isOpen(task))reason+=' · Sources give different dates; review timing';
    return {...entry,rank,reason,when,sourceCount:sourceIDs.size};
  }).sort((a,b)=>a.rank-b.rank || (a.when===b.when?0:a.when-b.when) || b.task.priority-a.task.priority || a.task.createdAt-b.task.createdAt || a.id.localeCompare(b.id));
}
