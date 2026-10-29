import { describe, it, expect } from 'vitest';
import { toFilename, parseFilename, toSidecarFilename, parseSidecarFilename } from '../filename';

describe('toFilename', () => {
  it('creates a kebab-case filename with short ID', () => {
    expect(toFilename('Meeting Notes', 'a1b2c3d4-5678-90ab-cdef-1234567890ab')).toBe(
      'meeting-notes-a1b2c3.maple.md',
    );
  });

  it('handles special characters by stripping them', () => {
    expect(toFilename("What's Next? (2026)", 'ff00aabb-1234-5678-9abc-def012345678')).toBe(
      'whats-next-2026-ff00aa.maple.md',
    );
  });

  it('handles empty title', () => {
    expect(toFilename('', 'a1b2c3d4-5678-90ab-cdef-1234567890ab')).toBe('a1b2c3.maple.md');
  });

  it('truncates long titles at 60 chars', () => {
    const longTitle = 'a'.repeat(100);
    const result = toFilename(longTitle, 'a1b2c3d4-5678-90ab-cdef-1234567890ab');
    // 60 chars of title + '-' + 6 char ID + '.maple.md'
    expect(result).toBe('a'.repeat(60) + '-a1b2c3.maple.md');
  });

  it('collapses multiple spaces and hyphens', () => {
    expect(toFilename('hello   world---test', 'abcdef12-0000-0000-0000-000000000000')).toBe(
      'hello-world-test-abcdef.maple.md',
    );
  });

  it('strips UUID hyphens when extracting short ID', () => {
    // Short ID is first 6 chars of UUID with hyphens removed
    expect(toFilename('test', 'a1-b2c3-d456-0000-0000-000000000000')).toBe('test-a1b2c3.maple.md');
  });
});

describe('parseFilename', () => {
  it('parses a standard filename', () => {
    expect(parseFilename('meeting-notes-a1b2c3.maple.md')).toEqual({
      title: 'meeting-notes',
      shortId: 'a1b2c3',
    });
  });

  it('parses an ID-only filename', () => {
    expect(parseFilename('a1b2c3.maple.md')).toEqual({
      title: '',
      shortId: 'a1b2c3',
    });
  });

  it('returns null for non-.maple.md files', () => {
    expect(parseFilename('readme.md')).toBeNull();
    expect(parseFilename('notes.txt')).toBeNull();
  });

  it('returns null for malformed filenames', () => {
    expect(parseFilename('.maple.md')).toBeNull();
    expect(parseFilename('no-id.maple.md')).toBeNull();
  });
});

describe('toSidecarFilename', () => {
  it('creates whiteboard sidecar filename', () => {
    expect(toSidecarFilename('architecture-a1b2c3', 'whiteboard')).toBe(
      'architecture-a1b2c3.whiteboard.json',
    );
  });

  it('creates kanban sidecar filename', () => {
    expect(toSidecarFilename('sprint-board-j0k1l2', 'kanban')).toBe(
      'sprint-board-j0k1l2.kanban.json',
    );
  });

  it('creates data sidecar filename', () => {
    expect(toSidecarFilename('api-config-m3n4o5', 'data')).toBe('api-config-m3n4o5.data.json');
  });
});

describe('parseSidecarFilename', () => {
  it('parses whiteboard sidecar', () => {
    expect(parseSidecarFilename('architecture-a1b2c3.whiteboard.json')).toEqual({
      stem: 'architecture-a1b2c3',
      type: 'whiteboard',
    });
  });

  it('parses kanban sidecar', () => {
    expect(parseSidecarFilename('sprint-board-j0k1l2.kanban.json')).toEqual({
      stem: 'sprint-board-j0k1l2',
      type: 'kanban',
    });
  });

  it('parses data sidecar', () => {
    expect(parseSidecarFilename('api-config-m3n4o5.data.json')).toEqual({
      stem: 'api-config-m3n4o5',
      type: 'data',
    });
  });

  it('returns null for non-sidecar files', () => {
    expect(parseSidecarFilename('notes.json')).toBeNull();
    expect(parseSidecarFilename('file.maple.md')).toBeNull();
  });
});
