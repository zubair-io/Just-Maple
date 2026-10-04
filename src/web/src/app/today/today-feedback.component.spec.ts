import {describe,it,expect} from 'vitest';
import { nextFeedback } from './today-feedback.component';
import type { MapleRun } from './today-document.service';
const empty={tasks:[],carryForward:[],hasMore:false};
describe('Actionable Today feedback',()=>{
 it('shows no invented alert when there is no pending work',()=>expect(nextFeedback(null,'',empty)).toBeNull());
 it('prioritizes real provider failure over general suggestions',()=>{const run={runID:'r',requestBlockID:'b',request:{text:'Summarize'},status:'failed'} as MapleRun;expect(nextFeedback(run,'Waiting',empty)?.action).toBe('retry');});
 it('routes missing configuration to settings and an unanchored reply to review',()=>{const run={runID:'r',requestBlockID:'b',status:'configuration_required'} as MapleRun;expect(nextFeedback(run,'',empty)?.action).toBe('configure');expect(nextFeedback({...run,status:'unapplied'},'',empty)?.action).toBe('insert');});
 it('changes the dismissal key when a suggested task changes version',()=>{const task={taskID:'t',title:'Review',version:1,evidenceIDs:['e']};const a=nextFeedback(null,'',{...empty,tasks:[task]});const b=nextFeedback(null,'',{...empty,tasks:[{...task,version:2}]});expect(a?.key).not.toBe(b?.key);expect(a?.action).toBe('review');});
});
