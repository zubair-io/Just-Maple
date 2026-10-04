import {describe,it,expect} from 'vitest';
import {mergeRecoveredWriting} from './draft-recovery';
describe('automatic recovered writing',()=>{
 it('merges separate edits without rewriting untouched bytes',()=>expect(mergeRecoveredWriting('one\n\ntwo\n\nthree\n','ONE\n\ntwo\n\nthree\n','one\n\ntwo\n\nTHREE\n')).toBe('ONE\n\ntwo\n\nTHREE\n'));
 it('preserves external deletion of an unchanged block',()=>expect(mergeRecoveredWriting('a\n\nremove\n\nz\n','a\n\nz\n','A\n\nremove\n\nz\n')).toBe('A\n\nz\n'));
 it('requires a separate copy for competing edits or an edit to a deleted block',()=>{expect(mergeRecoveredWriting('a\n','external\n','draft\n')).toBeNull();expect(mergeRecoveredWriting('a\nb\n','a\n','a\nB\n')).toBeNull();});
 it('handles matching versions and identical inserts without duplication',()=>{expect(mergeRecoveredWriting('base','base','draft')).toBe('draft');expect(mergeRecoveredWriting('base','same','same')).toBe('same');});
});
