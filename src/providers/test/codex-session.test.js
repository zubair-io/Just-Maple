import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACPProvider } from '../acp-provider.js';

async function fixture(t) {
  const cwd=await mkdtemp(path.join(tmpdir(),'maple-acp-test-'));
  const log=path.join(cwd,'rpc.jsonl');
  const p=new ACPProvider({id:'codex',displayName:'Synthetic Codex',cli:'node',adapterPath:fileURLToPath(new URL('../fixtures/acp-session.mjs',import.meta.url)),environment:{MAPLE_FIXTURE_LOG:log}});
  t.after(async()=>{await p.close();await rm(cwd,{recursive:true,force:true});});
  await p.start({cwd});
  return {p,cwd,messages:async()=> (await readFile(log,'utf8')).trim().split('\n').map(JSON.parse)};
}

test('restored Codex streams structured text and archives once in a stable workspace',async t=>{
 const {p,cwd,messages}=await fixture(t);
 const result=await p.send('synthetic extraction');
 assert.deepEqual(JSON.parse(result.text),{action:'Review the document'});
 assert.equal(result.raw.stopReason,'end_turn');
 await p.archiveSession();await p.archiveSession();
 const rpc=await messages();
 assert.equal(rpc.filter(x=>x.method==='session/new').length,1);
 assert.equal(rpc.find(x=>x.method==='session/new').params.cwd,cwd);
 assert.equal(rpc.find(x=>x.method==='session/set_mode').params.modeId,'read-only');
 assert.ok(rpc.findIndex(x=>x.method==='session/set_mode')<rpc.findIndex(x=>x.method==='session/prompt'));
 assert.equal(rpc.filter(x=>x.method==='session/delete').length,1);
 assert.equal(rpc.find(x=>x.method==='session/delete').params.sessionId,result.raw.sessionId);
});

test('Codex prompt failure is surfaced promptly and session can still be archived',async t=>{
 const {p,messages}=await fixture(t);
 await assert.rejects(p.send('fail',{timeoutMs:1000}),/synthetic failure/);
 await p.archiveSession();
 assert.equal((await messages()).filter(x=>x.method==='session/delete').length,1);
});

test('Codex timeout cancels and retains interrupted session cleanup',async t=>{
 const {p,messages}=await fixture(t);
 await assert.rejects(p.send('timeout',{timeoutMs:40}),/timed out/);
 await p.archiveSession();
 const rpc=await messages();
 assert.equal(rpc.filter(x=>x.method==='session/cancel').length,1);
 assert.equal(rpc.filter(x=>x.method==='session/delete').length,1);
});
