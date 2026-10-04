// Synthetic ACP transport fixture. Never contacts a provider.
import readline from 'node:readline';
import { appendFileSync } from 'node:fs';
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
for await (const line of readline.createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  appendFileSync(process.env.MAPLE_FIXTURE_LOG, JSON.stringify(m) + '\n');
  if (m.id === undefined) continue;
  if (m.method === 'initialize') send({ id:m.id, result:{ protocolVersion:1, agentCapabilities:{}, authMethods:[] } });
  else if (m.method === 'session/new') send({ id:m.id, result:{ sessionId:'synthetic-session',configOptions:[{id:'model',name:'Model',type:'select',category:'model',currentValue:process.env.MAPLE_FIXTURE_UNSUPPORTED ? 'unavailable-inherited' : 'synthetic-supported',options:[{value:'synthetic-supported',name:'Synthetic',description:'Fixture model'},{value:'synthetic-alternate',name:'Alternate',description:'Fixture alternate'},{value:'unavailable-inherited',name:'Unknown inherited',description:null}],_meta:{jetbrains:{air:{version:1,recommendedValue:process.env.MAPLE_FIXTURE_RECOMMENDED}}}}] } });
  else if (m.method === 'session/prompt') {
    const text=m.params.prompt[0].text;
    if (text === 'fail') send({ id:m.id, error:{ code:-32603, message:'synthetic failure' } });
    else if (text === 'unsupported-model' || text === 'terminal-failure') {
      const _meta={jetbrains:{air:{version:1,sessionFailure:{id:'synthetic-failure',revision:1,severity:'error',category:'provider_error',title:'The synthetic-model model is not supported when using Codex with a ChatGPT account. private-source-fragment'}}}};
      if(text === 'unsupported-model') send({method:'session/update',params:{sessionId:'synthetic-session',update:{sessionUpdate:'session_info_update',_meta}}});
      send({id:m.id,result:{stopReason:'end_turn',_meta}});
    }
    else if (text === 'recovered-warning') {
      send({method:'session/update',params:{sessionId:'synthetic-session',update:{sessionUpdate:'session_info_update',_meta:{jetbrains:{air:{version:1,sessionFailure:{severity:'warning',category:'provider_error',title:'temporary issue'}}}}}}});
      send({ method:'session/update', params:{ sessionId:'synthetic-session', update:{ sessionUpdate:'agent_message_chunk', content:{type:'text',text:'{"tasks":[]}'} } } });
      send({id:m.id,result:{stopReason:'end_turn'}});
    }
    else if (text !== 'timeout') {
      send({ method:'session/update', params:{ sessionId:'synthetic-session', update:{ sessionUpdate:'agent_message_chunk', content:{type:'text',text:'{"action":"Review the document"}'} } } });
      send({ id:m.id, result:{stopReason:'end_turn'} });
    }
  } else send({ id:m.id, result:{} });
}
