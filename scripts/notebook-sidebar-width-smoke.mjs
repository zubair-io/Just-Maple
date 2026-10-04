/** Synthetic UI journey; no private notebooks or live model calls. */
import {chromium,expect} from '../src/web/node_modules/@playwright/test/index.mjs';
import {syntheticBridge} from './today-synthetic-bridge.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const output='.build/notebook-sidebar-width';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(syntheticBridge);
 await page.goto((process.env.MAPLE_SMOKE_URL||'http://127.0.0.1:4330')+'/#/today');
 const store=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('maple.today.sources.smoke.v1')));
 await expect(page.locator('.notebook-folder')).toHaveCount(1);
 await page.locator('.notebook-folder summary').click();
 await page.getByRole('button',{name:'Synthetic notebook note',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Note editor',exact:true})).toContainText('A separate user-owned Markdown document.');
 await expect(page.locator('.note-list')).toHaveCount(0);
 const paper=page.locator('.note-paper');await expect.poll(async()=>(await paper.boundingBox()).width).toBe(800);
 const before=(await store()).generic.content;
 await page.screenshot({path:output+'/notebook.png'});
 await page.getByRole('button',{name:'Expand width',exact:true}).click();
 await expect.poll(async()=>(await paper.boundingBox()).width).toBeGreaterThan(800);
 assert.equal((await store()).generic.content,before);
 await page.screenshot({path:output+'/notebook-expanded.png'});
 await page.getByRole('button',{name:'Readable width',exact:true}).click();await expect.poll(async()=>(await paper.boundingBox()).width).toBe(800);
 await page.locator('.day-rail a').filter({hasText:'Today'}).click();
 await expect(page.getByRole('button',{name:'Note',exact:true})).toBeVisible();await page.getByRole('button',{name:'Note',exact:true}).click();
 const view=page.locator('maple-editor > div').filter({has:page.locator('.maple-editor-surface')}).last();
 await expect.poll(async()=>(await view.boundingBox()).width).toBe(800);
 const writing=(await store()).content;
 await page.getByRole('button',{name:'Expand width',exact:true}).click();await expect.poll(async()=>(await view.boundingBox()).width).toBeGreaterThan(800);assert.equal((await store()).content,writing);
 await page.getByRole('button',{name:'Canvas',exact:true}).click();
 await page.getByRole('button',{name:'Focus card: Synthetic proposal',exact:true}).click();
 await page.getByRole('button',{name:'Readable width',exact:true}).click();
 await expect.poll(async()=>(await page.locator('.canvas-writing-focus .canvas-camera-space').boundingBox()).width).toBe(800);
 await page.getByRole('button',{name:'Expand width',exact:true}).click();await expect.poll(async()=>(await page.locator('.canvas-writing-focus .canvas-camera-space').boundingBox()).width).toBeGreaterThan(800);
 assert.deepEqual(errors,[]);console.log('Notebook sidebar navigation and 800px/expanded writing contracts passed');
}finally{await browser.close();}
