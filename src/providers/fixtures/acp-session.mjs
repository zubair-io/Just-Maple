// Synthetic ACP transport fixture. Never contacts a provider.
import readline from 'node:readline';
import { appendFileSync } from 'node:fs';
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
for await (const line of readline.createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  appendFileSync(process.env.MAPLE_FIXTURE_LOG, JSON.stringify(m) + '\n');
  if (m.id === undefined) continue;
  if (m.method === 'initialize') send({ id:m.id, result:{ protocolVersion:1, agentCapabilities:{}, authMethods:[] } });
  else if (m.method === 'session/new') send({ id:m.id, result:{ sessionId:'synthetic-session' } });
  else if (m.method === 'session/prompt') {
    const text=m.params.prompt[0].text;
    if (text === 'fail') send({ id:m.id, error:{ code:-32603, message:'synthetic failure' } });
    else if (text !== 'timeout') {
      send({ method:'session/update', params:{ sessionId:'synthetic-session', update:{ sessionUpdate:'agent_message_chunk', content:{type:'text',text:'{"action":"Review the document"}'} } } });
      send({ id:m.id, result:{stopReason:'end_turn'} });
    }
  } else send({ id:m.id, result:{} });
}
