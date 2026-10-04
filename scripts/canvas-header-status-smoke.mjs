/** Synthetic recovered-draft conflict: no private documents or real editing session. */
import {chromium,expect} from '../src/web/node_modules/@playwright/test/index.mjs';
import {syntheticBridge} from './today-synthetic-bridge.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const output='.build/canvas-header-status';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(syntheticBridge);
 await page.addInitScript(()=>{const handler=window.webkit.messageHandlers.maple,send=handler.postMessage;handler.postMessage=async body=>{const result=await send(body);if(body.action==='todayOpen')return{...result,draft:{content:result.content+'\nSynthetic recovered writing.\n',revision:'synthetic-older-revision'}};return result;};});
 await page.goto((process.env.MAPLE_SMOKE_URL||'http://127.0.0.1:4330')+'/#/today');
 await expect(page.getByRole('textbox',{name:'Daily note editor',exact:true})).toBeVisible();
 await expect(page.getByRole('alert')).toHaveCount(0);
 const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('maple.today.sources.smoke.v1')));
 assert.ok((await saved()).recoveryCopies[0].content.includes('Synthetic recovered writing.'));
 assert.ok(!(await saved()).content.includes('Synthetic recovered writing.'));
 await expect(page.locator('.notebook-folder summary')).toContainText('2');
 const header=await page.locator('.canvas-floating-header').boundingBox();assert.ok(Math.abs(header.x+header.width/2-960)<1,'header centers in the window');
 await page.screenshot({path:output+'/canvas.png'});
 await page.setViewportSize({width:1024,height:768});const narrow=await page.locator('.canvas-floating-header').boundingBox();assert.ok(narrow.x>=240&&narrow.x+narrow.width<=1024);await page.reload();await expect(page.getByRole('textbox',{name:'Daily note editor',exact:true})).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);assert.equal((await saved()).recoveryCopies.length,1);
 assert.deepEqual(errors,[]);console.log('Centered header and automatic durable, idempotent draft recovery without a conflict banner passed');
}finally{await browser.close();}
