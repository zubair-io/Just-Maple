import {TestBed} from '@angular/core/testing';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {NativeBridge} from '../core/native-bridge.service';
import {BoardExclusionsComponent} from './board-exclusions.component';
afterEach(()=>TestBed.resetTestingModule());
describe('Ignored messages settings',()=>{
 it('lists saved rules and removes them only after acknowledgement',async()=>{
  const bridge=TestBed.inject(NativeBridge);let rules=[{id:'rule',label:'GitHub notification emails',connector:'*',account:'*',scope:'github'}];
  const native=vi.spyOn(bridge,'notebook').mockImplementation(async(action)=>{if(action==='boardRemoveExclusion'){rules=[];return{};}return rules;});
  const fixture=TestBed.createComponent(BoardExclusionsComponent);await fixture.whenStable();fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('GitHub notification emails');
  await fixture.componentInstance.remove('rule');fixture.detectChanges();
  expect(native).toHaveBeenCalledWith('boardRemoveExclusion',{id:'rule'});expect(fixture.nativeElement.textContent).toContain('No messages are ignored');
 });
 it('keeps the rule visible when removal fails',async()=>{
  const bridge=TestBed.inject(NativeBridge);vi.spyOn(bridge,'notebook').mockImplementation(async(action)=>{if(action==='boardRemoveExclusion')throw Error('Synthetic failure');return [{id:'rule',label:'GitHub notification emails',connector:'*',account:'*',scope:'github'}];});
  const fixture=TestBed.createComponent(BoardExclusionsComponent);await fixture.whenStable();await fixture.componentInstance.remove('rule');fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('GitHub notification emails');expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('Could not remove');
 });
});
