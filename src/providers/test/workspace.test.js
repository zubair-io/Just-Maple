import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { providerWorkspace } from '../workspace.js';
import { ACPProvider } from '../acp-provider.js';

test('repeated requests use one empty workspace', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'maple-workspace-test-'));
  try {
    const [first, second] = await Promise.all([providerWorkspace(home), providerWorkspace(home)]);
    assert.equal(first, second);
    assert.deepEqual(await readdir(first), []);
    assert.deepEqual(await readdir(path.dirname(first)), ['Provider Workspace']);
  } finally { await rm(home, { recursive: true, force: true }); }
});
test('archives only its own current Codex session once', async () => {
  const p = new ACPProvider({id:'codex'}), calls=[];
  p.session={sessionId:'fixture-session'};
  p.connection={agent:{request:async (...args)=>calls.push(args)}};
  await p.archiveSession(); await p.archiveSession();
  assert.deepEqual(calls,[['session/delete',{sessionId:'fixture-session'}]]);
  p.session={sessionId:'next-fixture-session'};
  await p.archiveSession();
  assert.equal(calls.length,2);
});
test('archive failures surface and remain retryable', async () => {
  const p = new ACPProvider({id:'codex'});
  p.session={sessionId:'fixture-session'};
  p.connection={agent:{request:async ()=>{throw new Error('fixture failure')}}};
  await assert.rejects(p.archiveSession());
  assert.equal(p.archivedSession,undefined);
  p.id='claude';
  await p.archiveSession();
});
