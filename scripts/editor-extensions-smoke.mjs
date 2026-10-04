/** Synthetic browser acceptance for editor UI, not live provider quality. */
import { chromium, expect } from '../src/web/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syntheticBridge } from './today-synthetic-bridge.mjs';
const output='.build/editor-extensions-smoke';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/New_York'});
await context.addInitScript(syntheticBridge);
await context.addInitScript(()=>{
  const handler=window.webkit.messageHandlers.maple, original=handler.postMessage;
  handler.postMessage=async body=>{
    if(body.action==='attachmentImport') {
      const ref='Attachments/'+'a'.repeat(64)+'.txt';localStorage.setItem('synthetic-attachment',body.base64);
      return {ref,name:body.name,mimeType:'text/plain',byteCount:atob(body.base64).length,kind:'file'};
    }
    if(body.action==='attachmentRead') return {status:'ready',dataURL:'data:text/plain;base64,'+localStorage.getItem('synthetic-attachment')};
    return original(body);
  };
});
const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto((process.env.MAPLE_SMOKE_URL||'http://127.0.0.1:4320')+'/#/today');
  const editor=page.getByRole('textbox',{name:'Daily note editor',exact:true});
  await expect(editor).toBeVisible();
  const endOfNote=async()=>{await editor.evaluate(el=>{el.focus();const range=document.createRange();range.selectNodeContents(el);range.collapse(false);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);});};
  const dock=page.getByRole('toolbar',{name:'Note formatting',exact:true});await expect(dock).toBeVisible();
  await expect.poll(async()=>{const b=await dock.boundingBox();return b.y>800 && b.y+b.height<=1000;}).toBe(true);
  await editor.getByRole('heading',{name:'Follow ups',exact:true}).hover();
  const grip=page.getByRole('button',{name:'Block actions; drag to reorder',exact:true});
  await expect(grip).toBeVisible();
  const paragraph=editor.locator('.maple-paragraph').first();const paragraphBounds=await paragraph.boundingBox();
  await grip.dragTo(paragraph,{targetPosition:{x:20,y:paragraphBounds.height-2}});
  await expect.poll(()=>page.evaluate(()=>{const content=JSON.parse(localStorage.getItem('maple.today.sources.smoke.v1')).content;return content.indexOf('"id":"heading"')>content.indexOf('"id":"prose"');})).toBe(true);
  await endOfNote();await editor.press('Enter');
  await editor.pressSequentially('/head');
  await expect(page.getByRole('option',{name:'Heading 2',exact:true})).toBeVisible();
  await editor.press('ArrowDown');await editor.press('Enter');await editor.pressSequentially('Synthetic editor heading');
  await expect(editor.getByRole('heading',{name:'Synthetic editor heading',exact:true})).toContainText('Synthetic editor heading');
  await editor.press('Enter');await editor.pressSequentially('Selected emphasis');for(let i=0;i<'Selected emphasis'.length;i++) await editor.press('Shift+ArrowLeft');
  await dock.getByRole('button',{name:'Bold · ⌘B',exact:true}).click();
  await expect(editor.locator('strong')).toContainText('Selected emphasis');
  await expect(page.getByRole('toolbar',{name:'Selection formatting',exact:true})).toBeVisible();
  // Rapid caret collapse + Enter must not replace the prior formatted selection.
  await editor.press('ArrowRight');await editor.press('Enter');
  await expect(editor).toContainText('Selected emphasis');
  await dock.getByRole('button',{name:'Insert a block',exact:true}).click();
  await page.getByRole('button',{name:'Warning callout',exact:true}).click();
  await editor.pressSequentially('Synthetic warning');
  await expect(editor.locator('aside[data-kind="warning"]')).toContainText('Synthetic warning');
  await expect(editor).toContainText('Selected emphasis');
  // Escape the container using the built-in end-of-document click/keyboard path.
  await endOfNote();await editor.press('ArrowDown');await editor.press('Enter');
  const station=page.getByRole('button',{name:'Collapse section: Synthetic editor heading',exact:true});
  await station.click();
  await expect(editor.locator('aside[data-kind="warning"]')).toBeHidden();
  await page.getByRole('button',{name:'Expand section: Synthetic editor heading',exact:true}).click();
  await expect(editor.locator('aside[data-kind="warning"]')).toBeVisible();
  await expect(editor).toContainText('Selected emphasis');
  await endOfNote();await editor.press('ArrowRight');
  await page.locator('input[type="file"]').setInputFiles({name:'synthetic-evidence.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic attachment bytes')});
  await expect(editor).toContainText('synthetic-evidence.txt');
  await expect(editor).toContainText('Selected emphasis');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('maple.today.sources.smoke.v1')).content)).toContain('maple-attachment');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('maple.today.sources.smoke.v1')).content)).toContain('Attachments/');
  await page.reload();await expect(editor).toContainText('Synthetic editor heading');await expect(editor).toContainText('Selected emphasis');
  await expect(editor.locator('strong')).toContainText('Selected emphasis');
  await expect(editor).toContainText('Synthetic warning');await expect(page.getByRole('button',{name:'Collapse section: Synthetic editor heading',exact:true})).toBeVisible();
  await expect(editor).toContainText('synthetic-evidence.txt');
  await expect(editor).toContainText('Selected emphasis');
  await page.screenshot({path:output+'/editor-light.png',fullPage:true});
  await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:output+'/editor-dark.png',fullPage:true});
  await page.setViewportSize({width:620,height:900});await expect(dock).toBeVisible();
  await expect.poll(async()=>{const b=await dock.boundingBox();return b.x>=0&&b.x+b.width<=620&&b.y+b.height<=900;}).toBe(true);
  await page.screenshot({path:output+'/editor-narrow.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('Editor synthetic acceptance passed: slash, formatting, callout, heading section folding, attachment, reopen, light/dark/narrow dock.');
} finally {await context.close();await browser.close();}
