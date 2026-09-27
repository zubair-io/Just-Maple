import { providerNamed } from './providers.js';
import { providerWorkspace } from './workspace.js';
// One isolated source per session: unrelated people's data must never share context.
let provider, directory;
let input = '';
const watchdog = setTimeout(async () => { await provider?.close(); process.exit(124); }, 210_000);
try {
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 100_000) throw new Error('Input too large');
  }
  const request = JSON.parse(input);
  provider = providerNamed(request.provider);
  const readiness = await provider.detect();
  if (!readiness.installed || !readiness.adapterInstalled || readiness.authenticated !== true) {
    process.stdout.write(JSON.stringify({ok:false,error:`Install and sign in using ${request.provider === 'codex' ? 'codex login (ChatGPT)' : 'claude auth login (claude.ai)'}.`}));
  } else if (request.action === 'detect') {
    process.stdout.write(JSON.stringify({ok:true,text:request.provider === 'codex' ? 'Signed in. ChatGPT extraction is unavailable until a tool-free mode is supported. Choose Claude or another provider.' : 'Signed in; ready for text-only extraction.'}));
  } else {
    if (typeof request.prompt !== 'string' || request.prompt.length > 80000) throw new Error('Invalid prompt');
    directory = await providerWorkspace();
    const result = await provider.send(request.prompt, {cwd:directory, timeoutMs:150_000});
    await provider.archiveSession();
    const text = result.text;
    if (!text || Buffer.byteLength(text)>64000 || result.raw.stopReason !== 'end_turn') throw new Error('Incomplete response');
    process.stdout.write(JSON.stringify({ok:true,text,sessionID:result.raw.sessionId,durationMs:result.durationMs}));
  }
} catch (error) {
  // Never return raw provider diagnostics, which can contain prompts or credentials.
  const limited = /usage limit|weekly limit|rate.?limit|hit your limit|resets|quota/i.test(String(error?.message));
  process.stdout.write(JSON.stringify({ok:false,error:error?.code === 'PROVIDER_ISOLATION_UNSUPPORTED' ? error.message : limited ? 'Provider subscription limit reached. Retry after your allowance resets.' : 'Provider could not complete this request. Check its login, subscription allowance and availability, then retry.'}));
} finally {
  // Also retire interrupted/failed requests when the adapter is still reachable.
  try { await provider?.archiveSession(); } catch {}
  await provider?.close();
  clearTimeout(watchdog);
}
