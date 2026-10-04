/** Synthetic-only Sources UI/transport acceptance; no real inbox or provider. */
import { chromium, expect } from '../src/web/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syntheticBridge } from './today-synthetic-bridge.mjs';
const output='.build/sources-controls-smoke'; await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1600,height:1000}});
await context.addInitScript(syntheticBridge);
await context.addInitScript(()=>{
 const handler=window.webkit.messageHandlers.maple, original=handler.postMessage.bind(handler);
 const f=window.__sourceControls={calls:[],checks:[],arrival:false,session:0};
 handler.postMessage=async body=>{
  if(body.action==='sourceChanges'){f.checks.push(structuredClone(body));return {hasNewEntries:f.arrival};}
  const result=await original(body);
  if(body.action!=='sourceList') return result;
  f.calls.push(structuredClone(body));f.session++;
  const items=result.items.map(row=>({...row,classificationState:row.status==='complete'?'succeeded':row.status==='pending'?'pending':'failed',analysisState:'complete',classificationProvider:'Synthetic recorded classifier',classificationModel:'fixture-v1',analysisBranches:[{stage:'tasks',state:'succeeded',provider:'Synthetic extractor'}],noteCount:2}));
  return {...result,items,snapshotCursor:{sessionID:'synthetic-'+f.session,offset:0,fingerprint:JSON.stringify(body.query)}};
 };
});
const page=await context.newPage(), errors=[], passed=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto((process.env.MAPLE_SMOKE_URL||'http://127.0.0.1:4323')+'/#/sources');
 await expect(page.locator('tbody tr')).toHaveCount(3);
 for(const title of ['Classification','Further analysis','In notes']) await expect(page.getByRole('columnheader',{name:title,exact:true})).toBeVisible();
 await expect(page.locator('tbody').getByText('Synthetic recorded classifier',{exact:false}).first()).toBeVisible();
 const types=page.locator('details.filter-options').filter({has:page.locator('summary').filter({hasText:/^Type/})});
 await types.locator('summary').click();
 await types.getByRole('checkbox',{name:'email',exact:true}).check();
 await types.getByRole('checkbox',{name:'imessage',exact:true}).check();
 await page.getByRole('button',{name:'Apply filters',exact:true}).click();
 await expect(page.locator('tbody tr')).toHaveCount(2);
 await expect(page.getByRole('button',{name:'Remove Type filter: email',exact:true})).toBeVisible();
 assert.deepEqual(await page.evaluate(()=>window.__sourceControls.calls.at(-1).query.types),['email','imessage']);
 const accounts=page.locator('details.filter-options').filter({has:page.locator('summary').filter({hasText:/^Account/})});
 await accounts.locator('summary').click();await accounts.getByRole('checkbox',{name:'work',exact:true}).check();
 await page.getByRole('button',{name:'Apply filters',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(1);
 const rows=await page.locator('tbody').innerText(),calls=await page.evaluate(()=>window.__sourceControls.calls.length);
 await page.evaluate(()=>window.__sourceControls.arrival=true);
 await expect(page.getByRole('button',{name:'Show new entries',exact:true})).toBeVisible({timeout:20000});
 assert.equal(await page.locator('tbody').innerText(),rows);
 assert.equal(await page.evaluate(()=>window.__sourceControls.calls.length),calls);
 await page.getByRole('button',{name:'Show new entries',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__sourceControls.calls.length)).toBe(calls+1);
 assert.deepEqual(await page.evaluate(()=>window.__sourceControls.calls.at(-1).query.accounts),['work']);
 passed.push('Multiple type values use OR; account dimension uses AND; arrival check leaves frozen rows unchanged until explicit refresh with same filters.');
 await page.getByRole('button',{name:'Remove Account filter: work',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(2);
 await page.goBack(); await expect(page.locator('tbody tr')).toHaveCount(1);
 await expect(page.getByRole('button',{name:'Remove Account filter: work',exact:true})).toBeVisible();
 await page.getByRole('searchbox',{name:'Find a source',exact:true}).fill('Synthetic private search');
 await page.getByRole('button',{name:'Apply filters',exact:true}).click();
 assert(!page.url().includes('private'));assert(!page.url().includes('search='));
 await expect(page.getByRole('button',{name:'Remove Search filter: Synthetic private search',exact:true})).toBeVisible();
 passed.push('Filter chips remove one dimension; Back restores applied arrays; message search stays out of URL.');
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(3);
 await expect(page.locator('.filter-chips')).toHaveCount(0);
 await page.locator('tbody details').first().locator('summary').click();await expect(page.locator('tbody').getByText('tasks: succeeded',{exact:false}).first()).toBeVisible();
 const tableRegion=page.getByRole('region',{name:'Source observations — scroll horizontally for all columns',exact:true});
 await tableRegion.focus();await page.keyboard.press('ArrowRight');
 await expect.poll(()=>tableRegion.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
 await tableRegion.evaluate(el=>el.scrollLeft=0);
 passed.push('Overflowing source columns remain keyboard-scrollable in a named table region.');
 await page.screenshot({path:output+'/sources-light.png',fullPage:true});await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:output+'/sources-dark.png',fullPage:true});
 assert.deepEqual(errors,[]);await fs.writeFile(output+'/results.json',JSON.stringify({fixture:'Synthetic transport/UI only; native query correctness tested separately.',passed,errors},null,2));console.log(passed.join('\n'));
}catch(error){await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser.close();}
