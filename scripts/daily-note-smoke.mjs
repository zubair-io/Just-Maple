/** Browser integration smoke for the real Angular UI. Synthetic bridge is injected only
 * into an isolated Playwright context; it is never bundled into the application.
 * Start `npm start --prefix src/web -- --port 4319` first, then run this file with Node.
 * Authoritative SQLite, source projection and native-host semantics have separate tests.
 */
import { chromium, expect } from '../src/web/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const base = process.env.MAPLE_SMOKE_URL || 'http://127.0.0.1:4319';
const output = path.resolve('.build/daily-note-smoke');
await fs.mkdir(output, { recursive: true });
function syntheticBridge(phone = false) {
  const key = 'maple.daily.smoke.store';
  const now = () => Date.now() / 1000;
  const day = new Intl.DateTimeFormat('en-CA').format(new Date());
  const initial = { blocks: [
    {id:'smoke-text',day,kind:'text',content:'Synthetic review: leave room for the afternoon.',version:1,position:0,createdAt:now(),updatedAt:now(),actor:'user',userEdited:true},
    {id:'smoke-task',day,kind:'task',content:'Draft the synthetic handoff outline',version:1,position:1,createdAt:now(),updatedAt:now(),actor:'user',userEdited:true},
    {id:'smoke-email',day,kind:'email',content:'Synthetic email: choose a laptop before Monday.',version:1,position:2,createdAt:now(),updatedAt:now(),actor:'bot',userEdited:false,source:{key:'test:email',eventID:'test-event',connector:'gmail',title:'Synthetic laptop choices',sender:'Test Sender'}}
  ], history: [], requests: {}, calls: [], revision:1 };
  const load = () => JSON.parse(localStorage.getItem(key) || JSON.stringify(initial));
  const save = value => localStorage.setItem(key, JSON.stringify(value));
  const note = (s, d, zone) => ({day:d,timeZone:zone || 'America/New_York',blocks:s.blocks.filter(b=>b.day===d&&!b.clearedAt),cleared:s.blocks.filter(b=>b.day===d&&b.clearedAt),revision:s.revision});
  const snapshot = {loaded:true,step:-1,name:'Synthetic UI review',connected:false,running:false,busy:false,message:'',error:'',count:0,world:null,importantPeople:[],claims:[],facts:[],prompts:{},decisions:[],work:[],queue:[],factQueue:[],calendarChoices:[],selectedCalendarIDs:[],appleCalendar:[],googleConfigured:false,googleAccount:'',googleConnected:false,googleBusy:false,googleStatus:'',googleMailEnabled:false,googleCalendarEnabled:false,googleContactsEnabled:false,googleContactsGranted:false,googleContactsStatus:'',googleMailStatus:'',googleCalendarStatus:'',googleCalendars:[],selectedGoogleCalendarIDs:[],googleCalendar:[],homeURL:'',homeEnabled:false,homeHasToken:false,homeExposedOnly:false,homeStatus:'',homeImporting:false,homeEntities:[],selectedHomeEntities:[],contactsEnabled:false,calendarEnabled:false,appleImporting:false,contactsStatus:'',calendarStatus:'',resume:'',messagesEnabled:false,messagesStatus:'',messagesError:'',extractor:'',companionCloudEnabled:false,companionStatus:'',companionPaired:false};
  window.webkit = {messageHandlers:{maple:{async postMessage(body) {
    const s=load();s.calls.push(body.action);save(s);
    if(body.action==='snapshot')return snapshot;
    if(body.action==='notebookCatalog')return {notebooks:[],notes:[]};
    if(body.action==='dailyNote'||body.action==='dailyCarryForward')return note(s,body.day,body.timeZone);
    if(body.action==='dailyBlockHistory')return s.history.filter(h=>h.subjects.includes(body.id));
    if(body.action==='dailyBlockMutate'){
      const r=body.record;const signature=JSON.stringify(r);const prior=s.requests[r.requestID];
      if(prior){if(prior.signature!==signature)throw Error('Request ID reused');return prior.result;}
      let b=s.blocks.find(x=>x.id===r.blockID);if((b?.version||0)!==r.expectedVersion)throw Error('This block changed. Your draft is preserved; reload before saving.');
      const before=b?JSON.stringify(b):undefined;
      if(r.kind==='create'){b={id:r.blockID,day:r.day,kind:r.blockKind,content:r.content,version:0,position:s.blocks.length,createdAt:now(),updatedAt:now(),actor:'user',userEdited:true};s.blocks.push(b);}
      else if(!b||b.day!==r.day)throw Error('Block moved to another day');
      if(r.kind==='edit'){if(r.content!==undefined)b.content=r.content;if(r.blockKind)b.kind=r.blockKind;b.userEdited=true;}
      if(r.kind==='clear')b.clearedAt=now();
      if(r.kind==='restore')delete b.clearedAt;
      if(r.kind==='move')b.day=r.targetDay;
      if(r.kind==='complete'){b.completedAt=now();b.clearedAt=now();}
      b.version++;b.updatedAt=now();b.actor='user';s.revision++;
      s.history.push({id:crypto.randomUUID(),sequence:s.revision,subjects:[b.id],type:'daily.block.'+r.kind,actor:'user',recordedAt:now(),effectiveAt:now(),before,after:JSON.stringify(b),correlationID:r.requestID});
      const result=note(s,r.day,r.timeZone);s.requests[r.requestID]={signature,result};save(s);return result;
    }
    throw Error('Unhandled synthetic bridge command: '+body.action);
  }}}};
  if (phone) {
    window.mapleHost = 'iphone';
    const desktopHost = window.webkit.messageHandlers.maple;
    window.webkit.messageHandlers.mapleCompanion = { async postMessage(body) {
      if (body.action === 'snapshot') return {deviceID:'synthetic-phone',captures:[],connectionStatus:'Synthetic cached preview',mac:{asOf:new Date().toISOString(),tasks:[],states:[]}};
      const result = await desktopHost.postMessage(body);
      return result && Array.isArray(result.blocks) ? {...result,sync:{status:'cached',pending:[],conflicts:[],asOf:Date.now()/1000}} : result;
    }};
  }
  save(load());
}
const browser = await chromium.launch({channel:'chrome',headless:true});
const context = await browser.newContext({viewport:{width:1440,height:1040},timezoneId:'America/New_York'});
await context.addInitScript(syntheticBridge);
const page = await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto(base+'/#/daily');
  await page.getByRole('heading',{name:'Today',exact:true}).waitFor();
  const block = id => page.locator(`[data-block-id="${id}"]`);
  await expect(block('smoke-email')).toBeVisible();
  await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
  await page.setViewportSize({width:430,height:956});
  await page.screenshot({path:path.join(output,'narrow-desktop.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'Mobile must not scroll horizontally');
  await page.setViewportSize({width:1440,height:1040});
  await block('smoke-text').getByLabel('Edit text block').fill('Synthetic edit survives reloading the daily note.');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('maple.daily.smoke.store')).blocks.find(b=>b.id==='smoke-text').content)).toBe('Synthetic edit survives reloading the daily note.');
  await page.reload();
  await expect(block('smoke-text').getByLabel('Edit text block')).toHaveValue('Synthetic edit survives reloading the daily note.');
  await block('smoke-email').getByRole('button',{name:'Clear',exact:true}).click();
  await expect(block('smoke-email')).toHaveCount(0);
  await page.getByRole('button',{name:'Undo clear',exact:true}).click();
  await expect(block('smoke-email')).toBeVisible();
  await block('smoke-task').getByRole('button',{name:'Move to tomorrow →',exact:true}).click();
  await expect(block('smoke-task')).toHaveCount(0);
  await page.reload();
  await expect(block('smoke-email')).toBeVisible();
  await expect(block('smoke-task')).toHaveCount(0);
  await page.getByRole('button',{name:'Next day',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Tomorrow',exact:true})).toBeVisible();
  await expect(block('smoke-task')).toBeVisible();
  await page.screenshot({path:path.join(output,'tomorrow.png'),fullPage:true});
  await page.getByRole('button',{name:'Previous day',exact:true}).click();
  for(const kind of ['text','heading','task','email','message','code']){
    await page.getByLabel('Block type',{exact:true}).selectOption(kind);
    await page.getByLabel('New block content',{exact:true}).fill(`Synthetic ${kind} block`);
    await page.getByRole('button',{name:'+ Add block',exact:true}).click();
    await expect(page.getByLabel('New block content',{exact:true})).toHaveValue('');
    await expect(page.locator('.daily-block textarea').filter({visible:true}).last()).toHaveValue(`Synthetic ${kind} block`);
  }
  const taskRow=page.locator('.daily-block').filter({has:page.getByLabel('Edit task block')});
  await taskRow.getByRole('checkbox',{name:'Complete task',exact:true}).check();
  await expect(taskRow).toHaveCount(0);
  await block('smoke-text').getByRole('button',{name:'Block history',exact:true}).click();
  await expect(page.getByRole('region',{name:'Daily note history'})).toContainText('daily.block.edit');
  await page.getByRole('button',{name:'Close history',exact:true}).click();
  while(await page.locator('.daily-block').count()){
    const count=await page.locator('.daily-block').count();
    await page.locator('.daily-block').first().getByRole('button',{name:'Clear',exact:true}).click();
    await expect(page.locator('.daily-block')).toHaveCount(count-1);
  }
  await expect(page.getByRole('heading',{name:'A little breathing room.',exact:true})).toBeVisible();
  await page.screenshot({path:path.join(output,'empty.png'),fullPage:true});
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('maple.daily.smoke.store')));
  assert.equal(state.blocks.filter(b=>b.id==='smoke-task').length,1,'Moved task identity must remain unique');
  assert(state.history.some(h=>h.type==='daily.block.complete'),'Completion should be distinct from clearing');
  assert(state.history.some(h=>h.type==='daily.block.restore'),'Undo must restore cleared content');
  assert.equal(errors.length,0,errors.join('\n'));
  const phoneContext = await browser.newContext({viewport:{width:430,height:956},timezoneId:'America/New_York',isMobile:true,hasTouch:true});
  await phoneContext.addInitScript(syntheticBridge, true);
  const phonePage = await phoneContext.newPage();
  phonePage.on('pageerror', error => errors.push(error.message));
  await phonePage.goto(base+'/#/daily');
  await expect(phonePage.getByRole('navigation',{name:'Companion sections'})).toBeVisible();
  await expect(phonePage.locator('[data-block-id="smoke-email"]')).toBeVisible();
  await expect(phonePage.getByText('Synthetic cached preview',{exact:true})).toBeVisible();
  assert.equal(await phonePage.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'Phone host must not scroll horizontally');
  await phonePage.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
  await phonePage.getByLabel('New block content',{exact:true}).fill('Synthetic phone writing');
  await phonePage.getByRole('button',{name:'+ Add block',exact:true}).click();
  await expect(phonePage.getByLabel('New block content',{exact:true})).toHaveValue('');
  await phonePage.reload();
  await expect(phonePage.locator('.daily-block textarea').last()).toHaveValue('Synthetic phone writing');
  await phoneContext.close();
  assert.equal(errors.length,0,errors.join('\n'));
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({ok:true,errors},null,2));
  console.log(JSON.stringify({ok:true,output}));
} finally {await browser.close();}
