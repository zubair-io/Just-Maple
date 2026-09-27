import { describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';
describe('Daily sidebar navigation',()=>{
 it('changes the selected date while already on the daily route',async()=>{
  const daily={flush:vi.fn().mockResolvedValue(true),open:vi.fn().mockResolvedValue(true)};
  const router={url:'/daily',navigateByUrl:vi.fn().mockResolvedValue(false)};
  await AppComponent.prototype.openDay.call({daily,router} as any,'2026-10-01');
  expect(daily.open).toHaveBeenCalledWith('2026-10-01');expect(router.navigateByUrl).not.toHaveBeenCalled();
 });
 it('does not switch dates if the previous notebook navigation guard rejects leaving',async()=>{
  const daily={flush:vi.fn().mockResolvedValue(true),open:vi.fn()};
  const router={url:'/notebooks',navigateByUrl:vi.fn().mockResolvedValue(false)};
  await AppComponent.prototype.openDay.call({daily,router} as any,'2026-10-01');
  expect(router.navigateByUrl).toHaveBeenCalledWith('/daily');expect(daily.open).not.toHaveBeenCalled();
 });
});
