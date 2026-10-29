import { describe, it, expect } from 'vitest';
import { parsePageLinks, serializePageLink } from '../page-links';

describe('parsePageLinks', () => {
  it('parses a link with shortId and title', () => {
    const matches = parsePageLinks('See [[d4e5f6|Project Plan]] for details.');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      shortId: 'd4e5f6',
      title: 'Project Plan',
      index: 4,
      raw: '[[d4e5f6|Project Plan]]',
    });
  });

  it('parses a link with shortId only', () => {
    const matches = parsePageLinks('Link to [[abc123]].');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      shortId: 'abc123',
      index: 8,
      raw: '[[abc123]]',
    });
  });

  it('parses multiple links in one string', () => {
    const matches = parsePageLinks('Link [[a1b2c3|Page A]] and [[d4e5f6|Page B]] here.');
    expect(matches).toHaveLength(2);
    expect(matches[0]!.shortId).toBe('a1b2c3');
    expect(matches[1]!.shortId).toBe('d4e5f6');
  });

  it('skips escaped links', () => {
    const matches = parsePageLinks('Normal [[abc123]] and escaped \\[[def456]].');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.shortId).toBe('abc123');
  });

  it('returns empty array when no links found', () => {
    const matches = parsePageLinks('No links here, just [brackets] and code.');
    expect(matches).toHaveLength(0);
  });
});

describe('serializePageLink', () => {
  it('serializes with title', () => {
    expect(serializePageLink('d4e5f6', 'Project Plan')).toBe('[[d4e5f6|Project Plan]]');
  });

  it('serializes without title', () => {
    expect(serializePageLink('abc123')).toBe('[[abc123]]');
  });
});
