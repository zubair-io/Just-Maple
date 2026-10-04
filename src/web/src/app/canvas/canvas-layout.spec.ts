import { describe, expect, it } from 'vitest';
import { readCanvas, writeCanvas, emptyCanvas, validateCanvas } from './canvas-layout';
import { decodeDaily, encodeDaily } from '../editor/daily-markdown-codec';
const layout = { v: 1 as const, cards: [{ id:'a', x:32,y:64,width:320,height:272,color:'yellow' as const, group:'box' }], groups:[{ id:'box',title:'Follow ups',x:16,y:0,width:700,height:400,folded:false }] };
describe('Canvas presentation codec', () => {
  it('preserves managed identity, arbitrary frontmatter and prose on round trip', () => {
    const prefix = '---\nmaple:\n  format: 1\n  document: "daily"\n  day: "2026-10-03"\ncustom: "Keep me"\n---\n';
    const raw = writeCanvas(prefix, layout) + '\n<!-- maple:block {"v":1,"id":"a"} -->\nMy **writing**.\n';
    const decoded = decodeDaily(raw);
    expect(decoded.sourceOnly).toBe(false);
    const saved = encodeDaily(decoded.prefix, decoded.doc);
    expect(readCanvas(decodeDaily(saved).prefix)).toEqual(layout);
    expect(saved).toContain('  document: "daily"');
    expect(saved).toContain('custom: "Keep me"');
    expect(saved).toContain('My **writing**.');
    expect(saved).toContain('"id":"a"');
  });
  it('retains CRLF and replaces only the presentation field', () => {
    const prefix = '---\r\nmaple:\r\n  format: 1\r\n  document: "daily"\r\n---\r\n';
    const once = writeCanvas(prefix, layout), twice = writeCanvas(once, { ...layout, cards: [] });
    expect(twice.match(/mapleCanvas:/g)).toHaveLength(1);
    expect(twice).toContain('  document: "daily"\r\n');
    expect(readCanvas(twice).cards).toEqual([]);
  });
  it.each([{ ...layout,v:2 },{ ...layout,cards:[{...layout.cards[0],x:NaN}] },{ ...layout,cards:[{...layout.cards[0],group:'missing'}] },{ ...layout,cards:[layout.cards[0],layout.cards[0]] }])('rejects unsupported or invalid layout rather than losing it', value => {
    expect(() => validateCanvas(value)).toThrow();
    expect(decodeDaily('---\nmapleCanvas: '+JSON.stringify(value)+'\n---\nKeep this.').sourceOnly).toBe(true);
  });
  it('does not rewrite an unfamiliar metadata representation', () => {
    const raw='---\nmapleCanvas:\n  v: 2\n---\nComplete private writing.';
    expect(decodeDaily(raw).sourceOnly).toBe(true);
    expect(() => writeCanvas(decodeDaily(raw).prefix,emptyCanvas())).toThrow();
  });
});
describe('Canvas connections',()=>{
 const cards=[{id:'a',x:0,y:0,width:320,height:272,color:'paper' as const},{id:'b',x:400,y:0,width:320,height:272,color:'paper' as const}];
 const connected={v:1 as const,cards,groups:[],connections:[{id:'link',from:'a',to:'b',label:'Supports'}]};
 it('round trips links without a second prose authority',()=>{expect(readCanvas(writeCanvas('',connected))).toEqual(connected);});
 it.each([{...connected,connections:[{...connected.connections[0],to:'missing'}]},{...connected,connections:[{...connected.connections[0],to:'a'}]},{...connected,connections:[...connected.connections,{...connected.connections[0],id:'second'}]}])('rejects invalid and duplicated edges',value=>expect(()=>validateCanvas(value)).toThrow());
});
