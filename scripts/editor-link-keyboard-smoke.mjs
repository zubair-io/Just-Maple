/** Synthetic browser fixture; no private notes or native/provider writes. */
import { chromium, expect } from '../src/web/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syntheticBridge } from './today-synthetic-bridge.mjs';
const output='.build/editor-link-keyboard-smoke';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1400,height:1050}});await context.addInitScript(syntheticBridge);
const page=await context.newPage(),errors=[],passed=[];page.on('pageerror',error=>errors.push(error.message));
const editor=page.getByRole('textbox',{name:'Daily note editor',exact:true}),bubble=page.getByRole('toolbar',{name:'Selection formatting',exact:true});
try{
 await page.goto((process.env.MAPLE_SMOKE_URL||'http://127.0.0.1:4323')+'/#/today');await expect(editor).toBeVisible();
 const prose=editor.locator('.maple-paragraph p').filter({hasText:'Synthetic review:'}).first();
 await prose.evaluate(el=>{const root=el.closest('[contenteditable=true]');root.focus();const range=document.createRange();range.setStart(el.firstChild,0);range.setEnd(el.firstChild,9);const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);});
 await expect(bubble).toBeVisible();await expect(bubble.getByRole('button',{name:'Apply link',exact:true})).not.toBeVisible();
 // Focus the real floating menu to verify its native keyboard interaction, not Angular internals.
 await bubble.getByRole('button',{name:'Link',exact:true}).focus();await page.keyboard.press('Enter');
 const input=bubble.getByRole('textbox',{name:'Link URL',exact:true});await expect(input).toBeFocused();
 await input.fill('https://example.com/synthetic');
 await input.evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));});
 await expect(input).toBeVisible();assert.equal(await prose.locator('a').count(),0);
 await bubble.getByRole('button',{name:'Apply link',exact:true}).evaluate(el=>el.click());assert.equal(await prose.locator('a').count(),0);
 await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
 await page.keyboard.press('Escape');await expect(input).not.toBeVisible();await expect(bubble.getByRole('button',{name:'Link',exact:true})).toBeFocused();
 await page.keyboard.press('Enter');await expect(input).toBeFocused();await input.fill('https://example.com/synthetic');await page.keyboard.press('Enter');
 await expect(prose.locator('a')).toHaveText('Synthetic');await expect(prose.locator('a')).toHaveAttribute('href','https://example.com/synthetic');
 await expect(bubble.getByRole('button',{name:'Apply link',exact:true})).not.toBeVisible();
 passed.push('Link draft opens from keyboard; synthetic IME Enter/click do not apply unfinished URL; Escape cancels only URL draft and returns focus with exact selection retained.');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('maple.today.sources.smoke.v1')).content)).toContain('[Synthetic](https://example.com/synthetic)');
 await page.screenshot({path:output+'/synthetic-link.png',fullPage:true});await page.reload();await expect(editor.locator('a[href="https://example.com/synthetic"]')).toHaveText('Synthetic');
 passed.push('Explicit final Enter applies selected-text link and Markdown save/reload retains it; Apply link is hidden outside URL editing.');
 assert.deepEqual(errors,[]);await fs.writeFile(output+'/results.json',JSON.stringify({fixture:'Synthetic DOM composition and browser keyboard test, not OS IME or native WKWebView certification.',passed,errors},null,2));console.log(JSON.stringify({status:'pass',passed,output},null,2));
}catch(error){await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});throw error;}finally{await browser.close();}
