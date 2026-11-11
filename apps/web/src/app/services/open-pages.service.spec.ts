import { beforeEach, describe, expect, it } from 'vitest';
import { OpenPagesService } from './open-pages.service';

describe('OpenPagesService', () => {
  beforeEach(() => sessionStorage.clear());

  it('puts a newly opened page in first place and moves the others along', () => {
    const service = new OpenPagesService();
    service.open('nb', 'memo');
    service.open('nb', 'chat');
    service.open('nb', 'board');
    expect(service.ids('nb')).toEqual(['board', 'chat', 'memo']);
  });

  it('brings a page that is already open back to first place without repeating it', () => {
    const service = new OpenPagesService();
    service.open('nb', 'memo');
    service.open('nb', 'chat');
    service.open('nb', 'memo');
    expect(service.ids('nb')).toEqual(['memo', 'chat']);
  });

  it('keeps each notebook’s open pages apart', () => {
    const service = new OpenPagesService();
    service.open('one', 'a');
    service.open('two', 'b');
    expect(service.ids('one')).toEqual(['a']);
    expect(service.ids('two')).toEqual(['b']);
    expect(service.ids(null)).toEqual([]);
  });

  it('closes one page and leaves the rest in order', () => {
    const service = new OpenPagesService();
    ['a', 'b', 'c'].forEach((id) => service.open('nb', id));
    service.close('nb', 'b');
    expect(service.ids('nb')).toEqual(['c', 'a']);
  });

  it('keeps at most eight pages open, dropping the oldest', () => {
    const service = new OpenPagesService();
    for (let i = 1; i <= 10; i++) service.open('nb', `p${i}`);
    expect(service.ids('nb')).toHaveLength(8);
    expect(service.ids('nb')[0]).toBe('p10');
    expect(service.ids('nb')).not.toContain('p1');
  });

  it('remembers open pages for the browser tab, and ignores damaged storage', () => {
    const first = new OpenPagesService();
    first.open('nb', 'memo');
    expect(new OpenPagesService().ids('nb')).toEqual(['memo']);

    sessionStorage.setItem('maple-open-pages', '{"nb":"oops","ok":["a",3]}');
    const damaged = new OpenPagesService();
    expect(damaged.ids('nb')).toEqual([]);
    expect(damaged.ids('ok')).toEqual(['a']);
  });
});
