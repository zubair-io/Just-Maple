/** Synthetic local browser fixture only: no user tasks, providers, or native writes. */
import { chromium, expect } from '../src/web/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syntheticBridge } from './today-synthetic-bridge.mjs';
const output='.build/task-action-draft-smoke';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1360,height:1100},timezoneId:'America/New_York'});
await context.addInitScript(syntheticBridge);
await context.addInitScript(()=>{
 const handler=window.webkit.messageHandlers.maple,original=handler.postMessage.bind(handler);
 const task={id:'synthetic-task',ownerID:'local',title:'Synthetic action target',description:'Synthetic version pinning fixture',status:'open',waitingReason:'',assignee:'Synthetic owner',place:'',people:[],priority:0,conditions:[],evidenceIDs:[],activityIDs:[],version:3,createdAt:1,updatedAt:1,due:{kind:'date',date:'2099-01-01',timeZone:'America/New_York'}};
 const f=window.__actionFixture={calls:[],failNext:true,world:{revision:1,asOf:Date.now()/1000,activities:[],tasks:[task],states:[],suggestions:[],series:[],attention:[],history:[],properties:[]}};
 handler.postMessage=async body=>{
  if(body.action==='applyTaskAction'){
   f.calls.push(structuredClone(body));
   if(f.failNext){f.failNext=false;throw Error('Synthetic lost acknowledgement');}
   if(body.expectedVersion!==f.world.tasks[0].version)throw Error('Synthetic stale task');
   return {...await original({action:'snapshot'}),world:structuredClone(f.world)};
  }
  const result=await original(body);return body.action==='snapshot'?{...result,world:structuredClone(f.world)}:result;
 };
});
const page=await context.newPage(),errors=[],passed=[];
page.on('pageerror',error=>errors.push(error.message));
const actions=page.locator('maple-task-actions');
try{
 await page.goto((process.env.MAPLE_SMOKE_URL||'http://127.0.0.1:4323')+'/#/tasks/synthetic-task');
 await expect(page.getByRole('heading',{name:'Synthetic action target',exact:true})).toBeVisible();
 await actions.getByRole('button',{name:'Later',exact:true}).click();
 await actions.getByLabel('Resurface at',{exact:true}).fill('2099-01-02T10:00');
 await expect(actions.getByRole('status')).toContainText('deadline will stay unchanged');
 await page.evaluate(()=>{window.__actionFixture.world.tasks[0].version=4;window.__actionFixture.world.revision++;});
 await expect(actions.getByRole('alert')).toBeVisible({timeout:6000});
 await expect(actions.getByRole('button',{name:'Save for later',exact:true})).toBeDisabled();
 assert.deepEqual(await page.evaluate(()=>window.__actionFixture.calls),[]);
 await actions.getByRole('button',{name:'Cancel',exact:true}).click();
 await actions.getByRole('button',{name:'Later',exact:true}).click();
 await expect(actions.getByRole('alert')).not.toBeVisible();
 await actions.getByRole('button',{name:'Save for later',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__actionFixture.calls.length)).toBe(1);
 await actions.getByRole('button',{name:'Later',exact:true}).click();
 await actions.getByRole('button',{name:'Save for later',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__actionFixture.calls.length)).toBe(2);
 const calls=await page.evaluate(()=>window.__actionFixture.calls);
 assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1].expectedVersion,4);assert.equal(calls[1].id,'task:synthetic-task');
 assert.equal(Object.hasOwn(calls[1].change,'due'),false);
 passed.push('Live task version invalidates open Later draft; explicit cancel/reopen uses latest version, lost-ack retry reuses complete immutable command.');
 await actions.getByRole('button',{name:'Waiting',exact:true}).click();
 await actions.getByLabel('Waiting on',{exact:true}).fill('Synthetic reviewer');
 await actions.getByLabel('Review again',{exact:true}).fill('2099-01-03T10:00');
 await expect(actions.getByRole('status')).toContainText('deadline will stay unchanged');
 await actions.getByRole('button',{name:'Save waiting status',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__actionFixture.calls.length)).toBe(3);
 const waiting=await page.evaluate(()=>window.__actionFixture.calls[2]);
 assert.equal(waiting.change.kind,'waiting');assert.equal(waiting.change.waitingOn,'Synthetic reviewer');assert.equal(Object.hasOwn(waiting.change,'due'),false);
 assert.deepEqual(await page.evaluate(()=>window.__actionFixture.world.tasks[0].due),{kind:'date',date:'2099-01-01',timeZone:'America/New_York'});
 passed.push('Waiting review warns after deadline; neither Later nor Waiting alters the original date-only deadline or time zone.');
 await page.screenshot({path:output+'/synthetic-actions.png',fullPage:true});
 assert.deepEqual(errors,[]);
 await fs.writeFile(output+'/results.json',JSON.stringify({fixture:'Synthetic task/transport fixture; native storage idempotency and physical iPhone not exercised.',passed,errors},null,2));
 console.log(JSON.stringify({status:'pass',passed,output},null,2));
}catch(error){await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser.close();}
