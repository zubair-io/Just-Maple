import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompanionComponent } from './companion.component';

describe('iPhone companion',()=>{
  afterEach(()=>{delete (window as any).webkit;delete (window as any).mapleHost;TestBed.resetTestingModule();});
  it('keeps a failed capture draft and reuses its request ID for a safe retry',async()=>{
    const send=vi.fn().mockResolvedValueOnce({deviceID:'fixture',captures:[]}).mockRejectedValueOnce(new Error('write failed')).mockResolvedValueOnce({deviceID:'fixture',captures:[{id:'fixture',text:'Keep this thought',createdAt:new Date().toISOString()}]});
    (window as any).webkit={messageHandlers:{mapleCompanion:{postMessage:send}}};
    const fixture=TestBed.createComponent(CompanionComponent);await fixture.whenStable();
    const c=fixture.componentInstance;c.draft='Keep this thought';await c.save();
    expect(c.draft).toBe('Keep this thought');expect(c.error()).toContain('Could not save');
    const first=send.mock.calls[1][0];await c.save();
    expect(send.mock.calls[2][0].id).toBe(first.id);expect(c.draft).toBe('');expect(c.state().captures).toHaveLength(1);
  });
  it('shows persisted receipts and Mac tasks with activity tags',async()=>{
    const id='fixture-capture';
    const send=vi.fn().mockResolvedValue({deviceID:'fixture',captures:[{id,text:'Synthetic note',createdAt:new Date().toISOString()}],receivedIDs:[id],paired:true,connectionStatus:'Up to date',mac:{asOf:new Date().toISOString(),activities:[{id:'fixture-area',name:'Fixture area',kind:'area',lifecycle:'active',openTaskCount:1}],people:[{id:'fixture-person',name:'Fixture person',pinned:true,relationship:'Friend'}],states:[],tasks:[{id:'task',title:'Confirm the appointment time',status:'open',activities:['House'],due:'2026-10-01'}]}});
    (window as any).webkit={messageHandlers:{mapleCompanion:{postMessage:send}}};
    const fixture=TestBed.createComponent(CompanionComponent);await fixture.whenStable();fixture.detectChanges();
    const text=fixture.nativeElement.textContent;
    expect(text).not.toContain('Saved on this iPhone');expect(text).toContain('Confirm the appointment time');expect(text).toContain('House');expect(text).toContain('Last synced');
    expect(text).not.toContain('Waiting for Mac pairing');
    expect(text).toContain('Fixture area');await fixture.componentInstance.selectView('people');fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('Fixture person');expect(fixture.nativeElement.textContent).toContain('Pinned · Friend');
  });
  it('distinguishes cloud uploads from durable Mac receipts',async()=>{
    const send=vi.fn().mockResolvedValue({deviceID:'fixture',captures:[{id:'cloud-fixture',text:'Synthetic cloud note',createdAt:new Date().toISOString()}],uploadedIDs:['cloud-fixture'],receivedIDs:[],paired:true});
    (window as any).webkit={messageHandlers:{mapleCompanion:{postMessage:send}}};
    const fixture=TestBed.createComponent(CompanionComponent);await fixture.whenStable();fixture.detectChanges();
    await fixture.componentInstance.selectView('capture');fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Saved in iCloud · waiting for Mac');
    expect(fixture.nativeElement.textContent).not.toContain('Saved on Mac');
    expect(fixture.nativeElement.textContent).not.toContain('same network');
  });
  it('connects automatically without exposing pairing or pause controls',async()=>{
    const state={deviceID:'fixture',captures:[],cloudEnabled:true,connectionStatus:'Waiting for iCloud Keychain'};
    const send=vi.fn().mockResolvedValue(state);
    (window as any).webkit={messageHandlers:{mapleCompanion:{postMessage:send}}};
    const fixture=TestBed.createComponent(CompanionComponent);await fixture.whenStable();
    fixture.detectChanges();
    expect(send.mock.calls.every(c=>c[0].action==='snapshot')).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Waiting for iCloud Keychain');
    expect(fixture.nativeElement.textContent).not.toContain('Use iCloud');
    expect(fixture.nativeElement.textContent).not.toContain('Pause connection');
  });
  it('does not pretend to be connected without a native host',async()=>{
    const fixture=TestBed.createComponent(CompanionComponent);await fixture.whenStable();fixture.detectChanges();
    expect(fixture.componentInstance.loaded()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Connecting to iCloud');
    expect(fixture.nativeElement.textContent).toContain('could not be opened');
  });
  it('uses the shared overview and preserves Mac task order when filtering activities',async()=>{
    const send=vi.fn().mockResolvedValue({deviceID:'fixture',captures:[],mac:{asOf:new Date().toISOString(),displayName:'Fixture User',states:[{property:'presence',status:'known',value:'Home'}],activities:[{id:'area',name:'Shared area',kind:'area',lifecycle:'active',openTaskCount:2}],tasks:[{id:'b',title:'First from Mac',status:'waiting',activities:['Shared area']},{id:'a',title:'Second from Mac',status:'open',activities:['Shared area']}]}});
    (window as any).webkit={messageHandlers:{mapleCompanion:{postMessage:send}}};
    const fixture=TestBed.createComponent(CompanionComponent);await fixture.whenStable();fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('maple-overview-surface')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Fixture User');
    expect(fixture.nativeElement.textContent).not.toContain('Keep the thought');
    fixture.componentInstance.showActivity('area');fixture.detectChanges();
    expect([...fixture.nativeElement.querySelectorAll('[data-task-id]')].map((el:any)=>el.getAttribute('data-task-id'))).toEqual(['b','a']);
  });
  it('bounds phone Overview, isolates dated waiting work, and opens all activities and waiting tasks',async()=>{
    const waiting={id:'waiting',title:'Waiting on fixture actor',status:'waiting',due:'2026-01-01',activities:[]};
    const tasks=[waiting,...Array.from({length:8},(_,i)=>({id:'task-'+i,title:'Action '+i,status:'open',activities:[]})),{id:'done',title:'Completed work',status:'completed',activities:[]}];
    const activities=Array.from({length:9},(_,i)=>({id:'area-'+i,name:'Area '+i,kind:'area',lifecycle:'active',openTaskCount:0}));
    (window as any).webkit={messageHandlers:{mapleCompanion:{postMessage:vi.fn().mockResolvedValue({deviceID:'fixture',captures:[],mac:{asOf:new Date().toISOString(),states:[],tasks,activities}})}}};
    const fixture=TestBed.createComponent(CompanionComponent);await fixture.whenStable();fixture.detectChanges();
    expect([...fixture.nativeElement.querySelectorAll('[attention] [data-task-id]')].map((e:any)=>e.getAttribute('data-task-id'))).toEqual(['task-0','task-1','task-2','task-3','task-4']);
    expect(fixture.nativeElement.textContent).not.toContain(waiting.title);
    expect(fixture.nativeElement.textContent).toContain('Waiting · 1');
    expect(fixture.nativeElement.querySelectorAll('.activity-card')).toHaveLength(6);
    [...fixture.nativeElement.querySelectorAll('button')].find((b:any)=>b.textContent.includes('View all activities'))!.click();fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Area 8');
    await fixture.componentInstance.selectView('overview');fixture.detectChanges();
    [...fixture.nativeElement.querySelectorAll('button')].find((b:any)=>b.textContent.includes('Waiting ·'))!.click();fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-task-id]')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain(waiting.title);
    [...fixture.nativeElement.querySelectorAll('button')].find((b:any)=>b.textContent.includes('All tasks'))!.click();fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-task-id]')).toHaveLength(10);
    await fixture.componentInstance.selectView('overview');fixture.detectChanges();
    [...fixture.nativeElement.querySelectorAll('button')].find((b:any)=>b.textContent.includes('View all Needs you'))!.click();fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-task-id]')).toHaveLength(8);
    expect(fixture.nativeElement.textContent).not.toContain(waiting.title);
    expect(fixture.nativeElement.textContent).not.toContain('Completed work');
  });
  it('opens cached source fallback and copies it without completing or sending anything',async()=>{
    const source={id:'evidence-fixture',connector:'imessage',sender:'Fixture actor',occurredAt:'2026-09-24T10:00:00Z',content:'Could you confirm the delivery time?',available:true,truncated:false};
    const task={id:'task:source',title:'Confirm delivery time',status:'open',version:1,activities:[],sources:[source],sourceCount:1};
    const state={deviceID:'fixture',captures:[],mac:{asOf:new Date().toISOString(),states:[],tasks:[task]}};
    const send=vi.fn(async(body:any)=>body.action==='copySource'?{copied:true}:state);
    (window as any).webkit={messageHandlers:{mapleCompanion:{postMessage:send}}};
    const fixture=TestBed.createComponent(CompanionComponent);await fixture.whenStable();fixture.detectChanges();
    fixture.componentInstance.openTask(task);fixture.detectChanges();
    const open=[...fixture.nativeElement.querySelectorAll('[role="dialog"] button')].find((b:any)=>b.textContent.includes('Open source')) as HTMLButtonElement;open.click();fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('maple-source-inspector').textContent).toContain(source.content);
    expect(fixture.nativeElement.querySelector('maple-source-inspector').textContent).toContain(source.sender);
    const copy=[...fixture.nativeElement.querySelectorAll('maple-source-inspector button')].find((b:any)=>b.textContent.includes('Copy source')) as HTMLButtonElement;copy.click();await fixture.whenStable();
    expect(send.mock.calls.map(c=>c[0].action)).toEqual(['snapshot','copySource']);
  });
  it('opens task details and queues completion without claiming the Mac saved it',async()=>{
    const task={id:'task:fixture',title:'Confirm appointment',status:'open',version:3,detail:'Ask for the available morning time',activities:['House']};
    const state:any={deviceID:'fixture',captures:[],mac:{asOf:new Date().toISOString(),states:[],tasks:[task]}};
    const send=vi.fn(async(body:any)=>{
      if(body.action==='taskAction') return {...state,taskActions:[{id:body.id,taskID:body.taskID,expectedVersion:body.expectedVersion,status:body.status}]};
      return state;
    });
    (window as any).webkit={messageHandlers:{mapleCompanion:{postMessage:send}}};
    const fixture=TestBed.createComponent(CompanionComponent);await fixture.whenStable();fixture.detectChanges();
    const c=fixture.componentInstance;fixture.nativeElement.querySelector('[data-task-id] button').click();fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]').textContent).toContain(task.detail);
    const complete=[...fixture.nativeElement.querySelectorAll('[role="dialog"] button')].find((b:any)=>b.textContent.includes('Mark complete')) as HTMLButtonElement;complete.click();await fixture.whenStable();fixture.detectChanges();
    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({action:'taskAction',taskID:task.id,expectedVersion:3,status:'completed'});
    expect(fixture.nativeElement.textContent).toContain('Saved on iPhone · waiting for Mac');
    expect(fixture.nativeElement.textContent).not.toContain('Completed on Mac');
    const calls=send.mock.calls.length;await c.completeTask(task);expect(send.mock.calls.length).toBe(calls);
    c.state.set({...c.state(),taskActionReceipts:[{id:c.state().taskActions![0].id,outcome:'conflict'}]});fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Task changed on Mac');
  });
  it('opens the shared notebook editor on iPhone and protects edits when leaving fails',async()=>{
    (window as any).mapleHost='iphone';
    const send=vi.fn(async(body:any)=>{
      if(body.action==='notebookCatalog')return {cloudAvailable:true,notebooks:[{id:'book',name:'Fixture notebook',location:'iCloud',cloud:true,available:true,notes:[{path:'note.md',name:'Fixture note',modifiedAt:1}]}]};
      if(body.action==='noteRead')return {notebookID:'book',path:'note.md',content:'# A shared Markdown note',revision:'v1',indexingWarning:'Saved in your notebook. This large note was not queued for the Mac.'};
      if(body.action==='noteReadDraft')return null;
      if(body.action==='noteSave')throw Error('External edit conflict');
      if(body.action==='noteDraft')return {saved:true};
      return {deviceID:'fixture',captures:[]};
    });
    (window as any).webkit={messageHandlers:{mapleCompanion:{postMessage:send}}};
    const fixture=TestBed.createComponent(CompanionComponent);await fixture.whenStable();fixture.detectChanges();
    const component=fixture.componentInstance;
    const navigation=fixture.nativeElement.querySelector('nav[aria-label="Companion sections"]');
    expect(navigation.textContent).toContain('Notebooks');
    await component.selectView('notebooks');fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('maple-notebooks')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Fixture notebook');
    await component.notes.selectBook('book');await component.notes.open('note.md');fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('maple-markdown-editor')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('This large note was not queued for the Mac.');
    expect(fixture.nativeElement.querySelector('.notebook-layout.editor-open')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Notes in this notebook');
    component.notes.change('Keep my unsaved iPhone edit');await component.selectView('overview');fixture.detectChanges();
    expect(component.view()).toBe('notebooks');expect(component.notes.document()?.content).toBe('Keep my unsaved iPhone edit');
    expect(fixture.nativeElement.textContent).toContain('External edit conflict');
  });

  it('collapses only complete reviewed groups in All tasks and preserves filtered or missing children',async()=>{
    const tasks=[{id:'task:a',title:'First request',status:'open',version:1,activities:['One']},{id:'task:b',title:'Second request',status:'open',version:2,activities:['Two']},{id:'task:c',title:'New arrival',status:'open',version:1,activities:[]}];
    const group={review:{id:'review',context:{intentID:'Review requests',actorID:'Fixture actor',targetID:'Fixture target',connector:'fixture',account:'fixture',sourceScopeID:'thread'},maximumSpan:3600,children:[{nodeID:'task:a',expectedVersion:1},{nodeID:'task:b',expectedVersion:2}]},titles:{'task:a':'First request','task:b':'Second request'}};
    const state={deviceID:'fixture',captures:[],mac:{asOf:new Date().toISOString(),states:[],tasks,reviewedGroups:[group],reviewedGroupTotal:1}};
    (window as any).webkit={messageHandlers:{mapleCompanion:{postMessage:vi.fn().mockResolvedValue(state)}}};
    const fixture=TestBed.createComponent(CompanionComponent);await fixture.whenStable();const c=fixture.componentInstance;
    c.showTasks();fixture.detectChanges();
    expect(c.ungroupedTasks().map(t=>t.id)).toEqual(['task:c']);
    const details=fixture.nativeElement.querySelector('maple-companion-groups details');
    expect(details.open).toBe(false);expect(details.textContent).toContain('First request');expect(details.textContent).toContain('Second request');
    expect(fixture.nativeElement.querySelector('[data-task-id="task:a"]')).toBeNull();
    expect(c.attention().map(t=>t.id)).toEqual(['task:a','task:b','task:c']);
    c.filterTasks('One');fixture.detectChanges();
    expect(c.visibleGroups()).toEqual([]);expect(c.ungroupedTasks().map(t=>t.id)).toEqual(['task:a']);
    expect(fixture.nativeElement.querySelector('[data-task-id="task:a"]')).not.toBeNull();
    c.showNeedsYou();expect(c.ungroupedTasks()).toHaveLength(3);
    c.showTasks();c.state.set({...state,mac:{...state.mac,tasks:[tasks[0],tasks[2]]}});
    expect(c.visibleGroups()).toEqual([]);expect(c.ungroupedTasks().map(t=>t.id)).toEqual(['task:a','task:c']);
    c.state.set({...state,mac:{...state.mac,tasks:[{...tasks[0],version:3},tasks[1],tasks[2]]}});
    expect(c.visibleGroups()).toEqual([]);expect(c.ungroupedTasks()).toHaveLength(3);
  });

  it('filters long colliding activity labels by stable ID',async()=>{
    const prefix='A'.repeat(80);
    const state={deviceID:'fixture',captures:[],mac:{asOf:new Date().toISOString(),states:[],activities:[{id:'one',name:prefix+' one',kind:'area',lifecycle:'active',openTaskCount:1},{id:'two',name:prefix+' two',kind:'area',lifecycle:'active',openTaskCount:1}],tasks:[{id:'a',title:'First',status:'open',activities:[prefix],activityIDs:['one']},{id:'b',title:'Second',status:'open',activities:[prefix],activityIDs:['two']}]}};
    (window as any).webkit={messageHandlers:{mapleCompanion:{postMessage:vi.fn().mockResolvedValue(state)}}};
    const fixture=TestBed.createComponent(CompanionComponent);await fixture.whenStable();
    fixture.componentInstance.showActivity('two');fixture.detectChanges();
    expect(fixture.componentInstance.visibleTasks().map(t=>t.id)).toEqual(['b']);
  });
  it('uses typed row completion, preserves retries, and offers Undo after the task disappears',async()=>{
    const task={id:'task:fixture',title:'Fixture action',status:'open',version:3,activities:[]};
    const state:any={deviceID:'fixture',captures:[],mac:{asOf:new Date().toISOString(),states:[],tasks:[task],supportedTaskIntents:['done','later','waiting','notNeeded','undo']}};
    let fail=true;
    const send=vi.fn(async(body:any)=>{
      if(body.action!=='taskAction')return state;
      if(fail){fail=false;throw new Error('lost reply');}
      if(body.intent==='done')return {...state,mac:{...state.mac,tasks:[]},taskActions:[{id:body.id,taskID:body.taskID,expectedVersion:3,status:'completed',intent:'done'}],taskActionReceipts:[{id:body.id,outcome:'applied',resultingVersion:4}]};
      return state;
    });
    (window as any).webkit={messageHandlers:{mapleCompanion:{postMessage:send}}};
    const fixture=TestBed.createComponent(CompanionComponent);await fixture.whenStable();const c=fixture.componentInstance;
    await c.completeTask(task);await c.completeTask(task);
    const commands=send.mock.calls.map(c=>c[0]).filter(c=>c.action==='taskAction');
    expect(commands[0]).toEqual(commands[1]);expect(commands[0].intent).toBe('done');
    expect(c.undoableChanges()).toHaveLength(1);
    await c.undoChange(c.undoableChanges()[0]);
    const undo=send.mock.calls.at(-1)![0];expect(undo.intent).toBe('undo');expect(undo.expectedVersion).toBe(4);expect(undo.payload.targetMutationID).toBe(commands[0].id);
  });

});
