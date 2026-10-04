/** Synthetic browser checks; no live tasks, provider calls or external data. */
import { chromium, expect } from '../src/web/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syntheticBridge } from './today-synthetic-bridge.mjs';

function fixtures() {
  const handler = window.webkit.messageHandlers.maple, original = handler.postMessage.bind(handler);
  const task = { id:'synthetic-task', ownerID:'local', title:'Synthetic timed review', description:'Synthetic timing acceptance fixture.', status:'open', waitingReason:'', assignee:'Synthetic owner', place:'Home', people:[], priority:0, conditions:[], evidenceIDs:[], activityIDs:[], version:3, createdAt:1, updatedAt:1,
    due:{kind:'instant',date:'',instant:1790784023.125,timeZone:'Asia/Tokyo'}, scheduled:{kind:'instant',date:'',instant:1790697617.75,timeZone:'America/Chicago'} };
  const suggestion = (id, title) => ({id,candidate:{...structuredClone(task),id:'candidate-'+id,title,scheduled:{kind:'date',date:'2026-10-02',timeZone:'Europe/London'}},eventID:'synthetic-email',fingerprint:id,sourceKey:id,quote:'Synthetic quoted request',provider:'synthetic-provider',confidence:.93,deadlineExplanation:'Explicit timing in fixture',reviewStatus:'pending',possibleDuplicateIDs:[],version:2,createdAt:1});
  const fixture=window.__taskFixture={calls:[],world:{revision:1,asOf:Date.now()/1000,activities:[],tasks:[task],states:[],suggestions:[suggestion('first','Synthetic detected action'),suggestion('second','Another synthetic action')],series:[],attention:[],history:[],properties:[]}};
  handler.postMessage=async body=>{
    fixture.calls.push(structuredClone(body));
    if(body.action==='saveTask'){
      fixture.world.tasks=[{...body.record,version:body.expectedVersion+1}];
      return {...await original({action:'snapshot'}),world:structuredClone(fixture.world)};
    }
    if(body.action==='reviewSuggestion'){
      const s=fixture.world.suggestions.find(item=>item.id===body.id);
      if(body.expectedVersion!==s.version)throw Error('Synthetic stale version');
      s.candidate=body.record;s.reviewStatus='accepted';s.acceptedTaskID=body.record.id;s.version++;
      return {...await original({action:'snapshot'}),world:structuredClone(fixture.world)};
    }
    const result=await original(body);
    return body.action==='snapshot'?{...result,world:structuredClone(fixture.world)}:result;
  };
}
const output='.build/task-detail-acceptance';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1360,height:1050},timezoneId:'America/New_York'});
await context.addInitScript({content:`(${syntheticBridge.toString()})(); (${fixtures.toString()})();`});
const page=await context.newPage(),errors=[],passed=[];
page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto((process.env.MAPLE_SMOKE_URL||'http://127.0.0.1:4322')+'/#/tasks/synthetic-task');
  await expect(page.getByRole('heading',{name:'Synthetic timed review',exact:true})).toBeVisible();
  await expect(page.locator('maple-task-facts')).toContainText('Synthetic owner');
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await expect(page.locator('#scheduled-kind')).toHaveValue('instant');
  await page.getByRole('textbox',{name:'Task title',exact:true}).fill('Renamed synthetic review');
  await page.getByRole('button',{name:'Save task',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Renamed synthetic review',exact:true})).toBeVisible();
  const saved=await page.evaluate(()=>window.__taskFixture.calls.find(call=>call.action==='saveTask'));
  assert.equal(saved.expectedVersion,3);
  assert.deepEqual(saved.record.due,{kind:'instant',date:'',instant:1790784023.125,timeZone:'Asia/Tokyo'});
  assert.deepEqual(saved.record.scheduled,{kind:'instant',date:'',instant:1790697617.75,timeZone:'America/Chicago'});
  passed.push('Title-only editing preserves exact due/scheduled seconds and independent display zones through real Angular controls.');
  await page.evaluate(()=>location.hash='/suggestions/first');
  await expect(page.getByRole('heading',{name:'Synthetic detected action',exact:true})).toBeVisible();
  const sourceOpener=page.getByRole('button',{name:'Open source 1',exact:true});
  await sourceOpener.click();
  const sourceDrawer=page.getByRole('dialog',{name:'Source details',exact:true});
  await expect(sourceDrawer).toContainText('Synthetic captured original.');
  await sourceDrawer.getByRole('button',{name:'Processing',exact:true}).click();
  await expect(sourceDrawer).toContainText('classification');
  await page.keyboard.press('Escape');await expect(sourceDrawer).not.toBeVisible();
  await expect(sourceOpener).toBeFocused();
  const reads=await page.evaluate(()=>window.__taskFixture.calls);
  assert.equal(reads.filter(call=>call.action==='sourceDetail').length,1);
  assert.equal(reads.filter(call=>['reviewSuggestion','mapleSubmit','sourceRetry'].includes(call.action)).length,0);
  passed.push('Task evidence opens the shared full source/processing drawer and returns keyboard focus without task/model mutations.');
  await expect(page.locator('maple-task-facts')).toContainText('Europe/London');
  await expect(page.getByText('Provider: synthetic-provider',{exact:true})).not.toBeVisible();
  await page.getByText('Analysis details',{exact:true}).click();
  await expect(page.getByText('Provider: synthetic-provider',{exact:true})).toBeVisible();
  await page.getByText('Edit details or save as a manual task',{exact:true}).click();
  await expect(page.locator('#suggested-due-kind')).toHaveValue('instant');
  await expect(page.locator('#suggested-scheduled-kind')).toHaveValue('date');
  await page.getByRole('textbox',{name:'Proposed task title',exact:true}).fill('Reviewed synthetic action');
  await page.getByRole('button',{name:'Add task',exact:true}).click();
  await expect(page.getByText('Task added',{exact:true})).toBeVisible();
  const accepted=await page.evaluate(()=>window.__taskFixture.calls.find(call=>call.action==='reviewSuggestion'));
  assert.equal(accepted.record.title,'Reviewed synthetic action');assert.equal(accepted.record.due.instant,1790784023.125);
  assert.deepEqual(accepted.record.scheduled,{kind:'date',date:'2026-10-02',timeZone:'Europe/London'});
  passed.push('Detected action presents task facts before expandable model metadata; acceptance preserves exact due and independently zoned scheduled date.');
  await page.evaluate(()=>location.hash='/suggestions/second');
  await expect(page.getByRole('heading',{name:'Another synthetic action',exact:true})).toBeVisible();
  const details=page.locator('details').filter({has:page.getByText('Edit details or save as a manual task',{exact:true})});
  if(!await details.evaluate(element=>element.open))await details.locator('summary').click();
  await expect(page.getByRole('textbox',{name:'Proposed task title',exact:true})).toHaveValue('Another synthetic action');
  passed.push('Reused suggestion route resets identity and draft to the newly selected source action.');
  await page.screenshot({path:output+'/task-details-light.png',fullPage:true});
  await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:output+'/task-details-dark.png',fullPage:true});
  assert.deepEqual(errors,[]);
  await fs.writeFile(output+'/results.json',JSON.stringify({fixture:'Synthetic UI/transport verification, not live model quality.',passed,errors},null,2));
  console.log(passed.join('\n'));
}catch(error){await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await context.close();await browser.close();}
