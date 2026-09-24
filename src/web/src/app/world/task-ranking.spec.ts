import { describe, it, expect } from 'vitest';
import { rankTasks, dueInstant } from './task-ranking';
import { emptyWorld, newTask, Suggestion } from './world.models';
const now=Date.UTC(2026,8,22,16)/1000;
describe('task ranking',()=>{
  it('identifies whose commitment is waiting without assuming an email reply',()=>{
    const task={...newTask(),status:'waiting' as const,assignee:'Fixture Taylor',waitingReason:'I will deliver the replacement tomorrow.'};
    const row=rankTasks({...emptyWorld,asOf:now,tasks:[task]})[0];
    expect(row.reason).toContain('Waiting on Fixture Taylor');
    expect(row.reason).not.toContain('Waiting for a response');
  });
  it('mixes detected and saved tasks by urgency with stable ties, not insertion order',()=>{
    const late={...newTask(),id:'late',due:{kind:'instant' as const,date:'',instant:now-60,timeZone:'UTC'}};
    const next={...newTask(),id:'next',due:{kind:'instant' as const,date:'',instant:now+60,timeZone:'UTC'}};
    const plain={...newTask(),id:'plain'};
    const s:Suggestion={id:'source',candidate:late,eventID:'e',fingerprint:'f',sourceKey:'k',quote:'fixture',provider:'fixture',deadlineExplanation:'',reviewStatus:'pending',possibleDuplicateIDs:[],version:1,createdAt:now};
    const world={...emptyWorld,asOf:now,tasks:[plain,next],suggestions:[s]};
    expect(rankTasks(world).map(i=>i.task.id)).toEqual(['late','next','plain']);
    expect(rankTasks({...world,tasks:[next,plain]}).map(i=>i.id)).toEqual(rankTasks(world).map(i=>i.id));
    expect(rankTasks(world)[0].reason).toBe('Overdue');
    expect(rankTasks({...world,suggestions:[{...s,reviewStatus:'rejected'}]})).toHaveLength(2);
  });
  it('uses the deadline zone and DST for date-only deadlines',()=>{
    expect(dueInstant({kind:'date',date:'2026-03-08',timeZone:'America/New_York'},true)).toBe(Date.UTC(2026,2,9,4)/1000);
    const task={...newTask(),due:{kind:'date' as const,date:'2026-09-22',timeZone:'America/Los_Angeles'}};
    expect(rankTasks({...emptyWorld,asOf:now,tasks:[task]})[0].reason).not.toContain('Overdue');
  });
  it('keeps urgent responsibilities visible when context conflicts',()=>{
    const task={...newTask(),priority:3,conditions:[{subject:'person:self',property:'presence',value:'Home'}]};
    const row=rankTasks({...emptyWorld,asOf:now,tasks:[task],states:[{subject:'person:self',property:'presence',status:'known',value:'Airport',candidates:[],reason:'fixture',revision:1,asOf:now}]})[0];
    expect(row.rank).toBe(0);expect(row.reason).toContain('Current context differs');
  });
  it('does not duplicate a saved task when a detected update points to it',()=>{
    const task={...newTask(),id:'saved'};
    const suggestion:Suggestion={id:'update',candidate:{...task,id:'candidate'},eventID:'e',fingerprint:'f',sourceKey:'k',quote:'fixture',provider:'fixture',deadlineExplanation:'',reviewStatus:'pending',linkedTaskID:task.id,possibleDuplicateIDs:[],version:1,createdAt:now};
    const rows=rankTasks({...emptyWorld,asOf:now,tasks:[task],suggestions:[suggestion]});
    expect(rows).toHaveLength(1);expect(rows[0].id).toBe('task:saved');expect(rows[0].suggestion?.id).toBe('update');
  });

});

describe('consolidated task ranking',()=>{
  it('shows one row with all sources and tags, then restores separate rows after correction',()=>{
    const first={...newTask(),id:'a',title:'Send enrollment form',activityIDs:['one']};
    const second={...newTask(),id:'b',title:'Return enrollment form',activityIDs:['two'],due:{kind:'date' as const,date:'2026-10-10',timeZone:'UTC'}};
    const source=(id:string,candidate:typeof first):Suggestion=>({id,candidate,eventID:'event-'+id,fingerprint:id,sourceKey:id,quote:'fixture',provider:'fixture',deadlineExplanation:'',reviewStatus:'pending',possibleDuplicateIDs:[],version:1,createdAt:now});
    const world={...emptyWorld,asOf:now,suggestions:[source('a',first),source('b',second)],taskRelations:[{duplicateID:'source:b',primaryID:'source:a',reason:'Same obligation',evidenceIDs:['event-a','event-b']}]};
    const combined=rankTasks(world);
    expect(combined[0].task.due?.date).toBe('2026-10-10');expect(combined).toHaveLength(1);expect(combined[0].sourceCount).toBe(2);expect(combined[0].task.activityIDs).toEqual(['one','two']);
    expect(rankTasks({...world,taskRelations:[]})).toHaveLength(2);
  });
  it('keeps an inferred completion available in Completed while hiding it from open work',()=>{
    const task={...newTask(),status:'completed' as const};
    const rows=rankTasks({...emptyWorld,asOf:now,tasks:[task],taskProgress:[{nodeID:'task:'+task.id,status:'completed',eventID:'confirmation',quote:'I submitted it.',reason:'Submission confirmed',observedAt:now}]});
    expect(rows[0].task.status).toBe('completed');expect(rows[0].rank).toBe(6);expect(rows[0].task.evidenceIDs).toContain('confirmation');
  });
});
