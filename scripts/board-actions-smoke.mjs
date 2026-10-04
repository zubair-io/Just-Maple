/** Explicit synthetic transport; checks rendered card actions and persisted settings. */
import {chromium,expect} from '../src/web/node_modules/@playwright/test/index.mjs';
import {syntheticBridge} from './today-synthetic-bridge.mjs';
import fs from 'node:fs/promises';
const output='.build/board-actions';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(syntheticBridge);
 await page.addInitScript(()=>{
  const handler=window.webkit.messageHandlers.maple,send=handler.postMessage;let latest;
  const key='maple.synthetic.board-exclusions';
  handler.postMessage=async body=>{
   if(body.action==='boardExclusions')return JSON.parse(localStorage.getItem(key)||'[]');
   if(body.action==='boardExcludeSource'){const rule={id:'synthetic-github-rule',label:'GitHub notification emails',scope:'github',connector:'*',account:'*'};localStorage.setItem(key,JSON.stringify([rule]));return rule;}
   if(body.action==='boardRemoveExclusion'){localStorage.setItem(key,'[]');return{removed:true};}
   if(body.action==='documentBlockMutate'){
    const saved=JSON.parse(localStorage.getItem('maple.today.sources.smoke.v1'));
    saved.content=saved.content.replace(/<!-- maple:block {"v":1,"id":"email"} -->[\s\S]*?(?=<!-- maple:block|$)/,'');saved.revision='r2';localStorage.setItem('maple.today.sources.smoke.v1',JSON.stringify(saved));
    return{...latest,content:saved.content,revision:saved.revision,blocks:[],cleared:[]};
   }
   const result=await send(body);
   if(body.action==='todayOpen'){latest={...result,blocks:[{blockID:'email',version:1,kind:'source',eventID:'synthetic-email',content:'Synthetic GitHub notification'}],cleared:[]};return latest;}
   return result;
  };
 });
 await page.goto((process.env.MAPLE_SMOKE_URL||'http://127.0.0.1:4330')+'/#/today');
 await expect(page.getByRole('textbox',{name:'Daily note editor',exact:true})).toBeVisible();
 const menu=page.getByLabel('Actions for card: Synthetic proposal',{exact:true});await menu.click();
 await expect(page.getByRole('button',{name:'Done · hide from board',exact:true})).toBeVisible();
 await page.screenshot({path:output+'/card-menu.png'});
 await page.getByRole('button',{name:'Ignore GitHub notifications',exact:true}).click();
 await expect(menu).toHaveCount(0);
 await page.getByRole('button',{name:'Connections & settings',exact:true}).click();
 await expect(page.getByRole('region',{name:'Ignored messages'})).toContainText('GitHub notification emails');
 await page.screenshot({path:output+'/ignored-messages.png'});
 await page.reload();await expect(page.getByRole('region',{name:'Ignored messages'})).toContainText('GitHub notification emails');
 await page.getByRole('button',{name:'Stop ignoring',exact:true}).click();
 await expect(page.getByRole('region',{name:'Ignored messages'})).toContainText('No messages are ignored');
 if(errors.length)throw Error(errors.join('\n'));console.log('Synthetic card exclusion, durable settings list, and rule removal passed');
}finally{await browser.close();}
