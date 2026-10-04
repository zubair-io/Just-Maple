/** Synthetic source timing/history UI acceptance. No real sources or model calls. */
import { chromium, expect } from '../src/web/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syntheticBridge } from './today-synthetic-bridge.mjs';
const output='.build/source-history-smoke';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1360,height:900}});
await context.addInitScript(syntheticBridge);
await context.addInitScript(()=>{
 const handler=window.webkit.messageHandlers.maple,original=handler.postMessage.bind(handler);
 window.__historyFixture={olderCalls:0};
 handler.postMessage=async body=>{
  if(body.action==='sourceHistory'){
   if(body.beforeSequence===undefined)return {items:[],nextSequence:50};
   window.__historyFixture.olderCalls++;
   await new Promise(resolve=>window.__historyFixture.release=resolve);
   return {items:[{sequence:49,stage:'classification',fromState:'running',toState:'succeeded',at:100}],nextSequence:undefined};
  }
  const result=await original(body);
  if(body.action==='sourceDetail')return {...result,historyAvailability:'legacy_latest_only_before_audit',attempts:[
   {id:'synthetic-finished-attempt',stage:'classification',provider:'Synthetic provider',startedAt:100,endedAt:101.25,transportOutcome:'succeeded',commitOutcome:'applied'},
   {id:'synthetic-unfinished-attempt',stage:'tasks',startedAt:102,transportOutcome:'unknown',commitOutcome:'pending'}]};
  return result;
 };
});
const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
 await page.goto((process.env.MAPLE_SMOKE_URL||'http://127.0.0.1:4323')+'/#/sources/synthetic-email');
 const dialog=page.getByRole('dialog',{name:'Source details',exact:true});
 await dialog.getByRole('button',{name:'History',exact:true}).click();
 await expect(dialog).toContainText('Duration 1.3 s');await expect(dialog).toContainText('End time not recorded');
 await expect(dialog).toContainText('Duration unavailable');await expect(dialog).toContainText('Historical attempt detail was not recorded');
 const earlier=dialog.getByRole('button',{name:'Earlier history',exact:true});await earlier.click();
 await expect(earlier).toBeDisabled();await expect(dialog.getByRole('status')).toHaveText('Loading earlier history…');
 assert.equal(await page.evaluate(()=>window.__historyFixture.olderCalls),1);
 await page.evaluate(()=>window.__historyFixture.release());
 await expect(dialog).toContainText('running → succeeded');await expect(earlier).toHaveCount(0);
 await page.screenshot({path:output+'/history-light.png'});await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:output+'/history-dark.png'});
 assert.deepEqual(errors,[]);
 await fs.writeFile(output+'/results.json',JSON.stringify({fixture:'Synthetic transport only',passed:['Recorded attempt start/end/duration and missing timing render distinctly.','Missing legacy coverage is explicit.','History requests serialize and retain existing details while loading.'],errors},null,2));
 console.log('Synthetic history timing and serialized paging passed.');
}catch(error){await page.screenshot({path:output+'/failure.png'}).catch(()=>{});throw error;}
finally{await browser.close();}
