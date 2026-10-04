import { describe,expect,it } from 'vitest';
import { zoomAnchor,boundedZoom } from './canvas-navigation';
describe('Canvas camera geometry',()=>{
 it('keeps the point under a pinch stationary at any prior scale',()=>{for(const before of [.2,1,2.5]){const after=1.5,scroll=500,point=240;expect((zoomAnchor(scroll,point,before,after)+point)/after).toBeCloseTo((scroll+point)/before);}});
 it('keeps a pinch anchored when floating chrome adds a camera origin',()=>{const scroll=500,point=400,origin=272,before=1.2,after=1.7;expect((zoomAnchor(scroll,point,before,after,origin)+point-origin)/after).toBeCloseTo((scroll+point-origin)/before);});
 it('bounds magnification without quantizing trackpad input',()=>{expect(boundedZoom(.01)).toBe(.2);expect(boundedZoom(8)).toBe(2.5);expect(boundedZoom(1.137)).toBe(1.137);});
});
