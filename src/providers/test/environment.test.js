import test from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionEnvironment } from '../environment.js';
import { providerNamed } from '../providers.js';
test('subscription process cannot inherit API keys',()=>{
 const source={PATH:'/bin',OPENAI_API_KEY:'test',ANTHROPIC_API_KEY:'test',ANTHROPIC_AUTH_TOKEN:'test',CODEX_API_KEY:'test',OPENAI_ADMIN_KEY:'test'};
 assert.deepEqual(subscriptionEnvironment(source),{PATH:'/bin'});
 assert.equal(source.OPENAI_API_KEY,'test');
});
test('provider identifiers are an allowlist',()=>{
 assert.throws(()=>providerNamed('../../other'));
 assert.equal(providerNamed('codex').id,'codex');
});
