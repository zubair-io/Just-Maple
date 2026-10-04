import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACPProvider } from '../acp-provider.js';
import { MODEL_UNAVAILABLE, safeProviderError } from '../provider-errors.js';

async function fixture(t,environment={},start={}) {
  const cwd=await mkdtemp(path.join(tmpdir(),'maple-acp-test-'));
  const log=path.join(cwd,'rpc.jsonl');
  const p=new ACPProvider({id:'codex',displayName:'Synthetic Codex',cli:'node',adapterPath:fileURLToPath(new URL('../fixtures/acp-session.mjs',import.meta.url)),environment:{MAPLE_FIXTURE_LOG:log,...environment}});
  t.after(async()=>{await p.close();await rm(cwd,{recursive:true,force:true});});
  const messages=async()=> (await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
  if(start.deferStart!==true) await p.start({cwd,...start});
  return {p,cwd,messages};
}

test('restored Codex streams structured text and archives once in a stable workspace',async t=>{
 const {p,cwd,messages}=await fixture(t);
 const result=await p.send('synthetic extraction');
 assert.deepEqual(JSON.parse(result.text),{action:'Review the document'});
 assert.equal(result.raw.stopReason,'end_turn');
 await p.archiveSession();await p.archiveSession();
 const rpc=await messages();
 assert.equal(rpc.filter(x=>x.method==='session/new').length,1);
 assert.deepEqual(rpc.find(x=>x.method==='initialize').params.clientCapabilities._meta.jetbrains.air,{version:1,capabilities:['sessionFailure','recommendedValue']});
 assert.equal(rpc.find(x=>x.method==='session/new').params.cwd,cwd);
 assert.equal(rpc.find(x=>x.method==='session/set_mode').params.modeId,'read-only');
 assert.ok(rpc.findIndex(x=>x.method==='session/set_mode')<rpc.findIndex(x=>x.method==='session/prompt'));
 assert.equal(rpc.filter(x=>x.method==='session/delete').length,1);
 assert.equal(rpc.find(x=>x.method==='session/delete').params.sessionId,result.raw.sessionId);
});

test('unsupported inherited model uses only the advertised recommendation before any prompt',async t=>{
 const {p,messages}=await fixture(t,{MAPLE_FIXTURE_UNSUPPORTED:'1',MAPLE_FIXTURE_RECOMMENDED:'synthetic-alternate'});
 const rpc=await messages();
 assert.equal(p.model,'synthetic-alternate');
 assert.equal(rpc.find(x=>x.method==='session/set_config_option').params.value,'synthetic-alternate');
 assert.equal(rpc.filter(x=>x.method==='session/prompt').length,0);
});

test('supported inherited model is preserved despite another recommendation',async t=>{
 const {p,messages}=await fixture(t,{MAPLE_FIXTURE_RECOMMENDED:'synthetic-alternate'});
 assert.equal(p.model,'synthetic-supported');
 assert.equal((await messages()).filter(x=>x.method==='session/set_config_option').length,0);
});

test('explicit supported app model overrides inherited model for that session',async t=>{
 const {p,messages}=await fixture(t,{}, {model:'synthetic-alternate'});
 assert.equal(p.model,'synthetic-alternate');
 assert.equal((await messages()).find(x=>x.method==='session/set_config_option').params.value,'synthetic-alternate');
});

for (const [name,environment,model] of [
 ['explicit unsupported',{MAPLE_FIXTURE_RECOMMENDED:'synthetic-supported'},'unavailable-inherited'],
 ['unsupported with no recommendation',{MAPLE_FIXTURE_UNSUPPORTED:'1'},undefined],
 ['unsupported recommendation',{MAPLE_FIXTURE_UNSUPPORTED:'1',MAPLE_FIXTURE_RECOMMENDED:'unavailable-inherited'},undefined]
]) test(`${name} fails before inference with no substitute`,async t=>{
 const {p,cwd,messages}=await fixture(t,environment,{deferStart:true});
 await assert.rejects(p.start({cwd,model}),error=>error.code==='PROVIDER_MODEL_UNAVAILABLE');
 const rpc=await messages();
 assert.equal(rpc.filter(x=>x.method==='session/prompt').length,0);
 assert.equal(rpc.filter(x=>x.method==='session/set_config_option').length,0);
 assert.equal(rpc.filter(x=>x.method==='session/delete').length,1);
});

for (const kind of ['unsupported-model', 'terminal-failure']) {
 test(`Codex ${kind} cannot become an answer or a repair request`,async t=>{
  const {p,messages}=await fixture(t);
  await assert.rejects(p.send(kind), error => {
   assert.equal(error.code,'PROVIDER_REPORTED_FAILURE');
   assert.equal(safeProviderError(error),MODEL_UNAVAILABLE);
   assert.ok(!error.message.includes('private-source-fragment'));
   return true;
  });
  await p.archiveSession();
  const rpc=await messages();
  assert.equal(rpc.filter(x=>x.method==='session/prompt').length,1);
  assert.equal(rpc.filter(x=>x.method==='session/delete').length,1);
 });
}

test('Codex recovered warning still permits the successful response',async t=>{
 const {p}=await fixture(t);
 assert.deepEqual(JSON.parse((await p.send('recovered-warning')).text),{tasks:[]});
});

test('provider diagnostics are mapped without exposing bodies',()=>{
 assert.equal(safeProviderError({message:'private-source-fragment'}),'Provider could not complete this request. Check its login, subscription allowance and availability, then retry.');
 assert.equal(safeProviderError({category:'auth_required',message:'private-source-fragment'}),'Provider authentication expired. Sign in to the selected provider and test the connection again.');
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
