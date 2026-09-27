import { ChangeDetectionStrategy, Component, input, output, signal, inject } from '@angular/core';
import { MuiButtonComponent } from '@maple/ui';
import { NativeBridge } from '../core/native-bridge.service';
import { companionHost } from '../core/companion-host';
import { SourceEvidence } from './source.models';
@Component({selector:'maple-source-inspector',standalone:true,imports:[MuiButtonComponent],changeDetection:ChangeDetectionStrategy.OnPush,
 template:`<section class="source-inspector" role="region" aria-label="Source inspector">
 <div class="heading"><h3>{{source().subject || 'Original source'}}</h3><mui-button variant="ghost" (pressed)="closed.emit()">Close source</mui-button></div>
 @if(source().available){
 <dl><dt>Source</dt><dd>{{source().connector}}</dd><dt>Sender</dt><dd>{{source().sender || 'Not recorded in this source'}}</dd><dt>When</dt><dd>{{when()}}</dd></dl>
 <p class="muted">Showing the captured source. Direct opening in the original app is not available here.</p>
 @if(source().truncated){<p role="status">This is a shortened preview. Open this source on your Mac for the complete captured text.</p>}
 @if(source().content){<mui-button variant="ghost" (pressed)="copy()">Copy source text</mui-button><pre tabindex="0">{{source().content}}</pre>}
 @else{<p>The source text is not cached in this update. Open this source on your Mac.</p>}
 } @else {<p role="status">This source is unavailable in the current workspace. Its reference is preserved; reconnect the source or check it on your Mac.</p>}
 @if(copyStatus()){<p role="status">{{copyStatus()}}</p>}
 </section>`,
 styles:[`:host{display:block;margin:16px 0}.source-inspector{padding:16px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-bg-secondary)}.heading{display:flex;align-items:center;justify-content:space-between;gap:12px}h3{margin:0;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:14px}dt,.muted{color:var(--color-text-muted)}dd{margin:0;overflow-wrap:anywhere}pre{font:inherit;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;max-height:50vh;overflow:auto;user-select:text;-webkit-user-select:text;padding:12px;background:var(--color-bg)}p{font-size:14px}`]})
export class SourceInspectorComponent {
 readonly source=input.required<SourceEvidence>();readonly closed=output<void>();readonly copyStatus=signal('');
 private readonly bridge=inject(NativeBridge);
 when(){const value=this.source().occurredAt;if(value===undefined)return 'Not recorded';const date=new Date(typeof value==='number'?value*1000:value);return Number.isFinite(date.getTime())?date.toLocaleString():'Not recorded';}
 async copy(){
  const source=this.source();this.copyStatus.set('');
  const text=[source.subject,`Source: ${source.connector}`,`Sender: ${source.sender || 'Not recorded'}`,`When: ${this.when()}`,'',source.content,source.truncated?'[Shortened preview]':''].filter(v=>v!==undefined).join('\n');
  try{const host=companionHost();if(host)await host.postMessage({action:'copySource',text});else await this.bridge.copySource(text);this.copyStatus.set(source.truncated?'Preview copied.':'Source copied.');}
  catch{this.copyStatus.set('Could not copy. Select and copy the source text below.');}
 }
}
