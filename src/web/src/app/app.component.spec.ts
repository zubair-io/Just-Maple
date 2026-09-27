import { describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';
describe('Today sidebar navigation',()=>{
 it('flushes the current daily document before routing to a dated file',async()=>{
  const daily={flush:vi.fn().mockResolvedValue(true)};const router={navigateByUrl:vi.fn().mockResolvedValue(true)};
  await AppComponent.prototype.openDay.call({daily,router} as any,'2026-10-01');expect(daily.flush).toHaveBeenCalled();expect(router.navigateByUrl).toHaveBeenCalledWith('/today/2026-10-01');
 });
 it('keeps a conflicting draft open',async()=>{
  const daily={flush:vi.fn().mockResolvedValue(false)};const router={navigateByUrl:vi.fn()};await AppComponent.prototype.openDay.call({daily,router} as any,'2026-10-01');expect(router.navigateByUrl).not.toHaveBeenCalled();
 });
});
