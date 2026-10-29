import { describe, it, expect } from 'vitest';
import { computeAssetHash, toAssetFilename } from '../asset-hash';

describe('computeAssetHash', () => {
  it('returns a 6-char hex string', async () => {
    const content = new TextEncoder().encode('hello world');
    const hash = await computeAssetHash(content);
    expect(hash).toMatch(/^[0-9a-f]{6}$/);
  });

  it('returns the same hash for identical content', async () => {
    const content = new TextEncoder().encode('identical content');
    const hash1 = await computeAssetHash(content);
    const hash2 = await computeAssetHash(content);
    expect(hash1).toBe(hash2);
  });

  it('returns different hashes for different content', async () => {
    const content1 = new TextEncoder().encode('content A');
    const content2 = new TextEncoder().encode('content B');
    const hash1 = await computeAssetHash(content1);
    const hash2 = await computeAssetHash(content2);
    expect(hash1).not.toBe(hash2);
  });

  it('handles empty content', async () => {
    const hash = await computeAssetHash(new Uint8Array(0));
    expect(hash).toMatch(/^[0-9a-f]{6}$/);
  });
});

describe('toAssetFilename', () => {
  it('creates filename from hash and extension', () => {
    expect(toAssetFilename('3a7f2b', 'png')).toBe('3a7f2b.png');
  });

  it('handles extension with leading dot', () => {
    expect(toAssetFilename('e9c1d4', '.svg')).toBe('e9c1d4.svg');
  });
});
