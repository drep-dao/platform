import { describe, it, expect } from 'vitest';
import { cip20MessageChunks, buildCip20Message, CIP20_MESSAGE_LABEL } from './tx-message';

const utf8 = (s: string) => new TextEncoder().encode(s).length;

describe('cip20MessageChunks — split a comment into ≤64-byte CIP-20 lines', () => {
  it('keeps a short message as a single chunk', () => {
    expect(cip20MessageChunks('Thanks for the great work!')).toEqual(['Thanks for the great work!']);
  });
  it('returns [] for empty or whitespace-only input', () => {
    expect(cip20MessageChunks('')).toEqual([]);
    expect(cip20MessageChunks('\n\n')).toEqual([]);
  });
  it('starts a new chunk on each newline', () => {
    expect(cip20MessageChunks('line one\nline two')).toEqual(['line one', 'line two']);
  });
  it('hard-wraps a run longer than 64 bytes, every chunk within the limit', () => {
    const long = 'a'.repeat(200);
    const chunks = cip20MessageChunks(long);
    expect(chunks.length).toBe(Math.ceil(200 / 64));
    for (const c of chunks) expect(utf8(c)).toBeLessThanOrEqual(64);
    expect(chunks.join('')).toBe(long);
  });
  it('never splits a multi-byte code point across chunks', () => {
    // 'é' is 2 bytes; 33 of them = 66 bytes → must wrap without producing a broken byte.
    const chunks = cip20MessageChunks('é'.repeat(33));
    for (const c of chunks) expect(utf8(c)).toBeLessThanOrEqual(64);
    expect(chunks.join('')).toBe('é'.repeat(33));
  });
  it('keeps an emoji (surrogate pair / 4 bytes) intact', () => {
    const chunks = cip20MessageChunks('🎉'.repeat(20));
    for (const c of chunks) expect(utf8(c)).toBeLessThanOrEqual(64);
    expect(chunks.join('')).toBe('🎉'.repeat(20));
  });
  it('caps the number of chunks', () => {
    expect(cip20MessageChunks('x'.repeat(10_000), 3).length).toBe(3);
  });
});

describe('buildCip20Message — wrap under label 674', () => {
  it('wraps non-empty text', () => {
    expect(buildCip20Message('hi')).toEqual({ [CIP20_MESSAGE_LABEL]: { msg: ['hi'] } });
    expect(CIP20_MESSAGE_LABEL).toBe(674);
  });
  it('returns null for empty text', () => {
    expect(buildCip20Message('   ')).toBeNull();
  });
});
