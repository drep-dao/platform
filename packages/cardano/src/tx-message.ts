/**
 * CIP-20 — transaction message / comment metadata (label 674). A free-form note attached to a
 * transaction as `{ "674": { "msg": ["line 1", "line 2", …] } }`, where every string is at most
 * 64 BYTES of UTF-8 (the Cardano metadata string limit). Wallets and explorers (Cardanoscan,
 * adastat, …) render these natively in the transaction detail, so a donor's comment shows up both
 * on-chain and in our own treasury history. See https://cips.cardano.org/cip/CIP-20.
 */
export const CIP20_MESSAGE_LABEL = 674;

/** UTF-8 byte length of a single code point (dependency-free, isomorphic). */
function cpByteLen(cp: number): number {
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

/**
 * Split free text into CIP-20 `msg` chunks: each chunk ≤ 64 UTF-8 bytes, never splitting a
 * multi-byte code point (so emoji / accents survive). Newlines start a new chunk; a run longer than
 * 64 bytes is hard-wrapped. `maxChunks` caps the array (default 64) so a pasted essay can't bloat
 * the tx — anything past the cap is dropped. Returns [] for empty/whitespace-only input.
 */
export function cip20MessageChunks(text: string, maxChunks = 64): string[] {
  if (!text.trim()) return [];
  const chunks: string[] = [];
  let cur = '';
  let curBytes = 0;
  const push = () => {
    if (cur.length) chunks.push(cur);
    cur = '';
    curBytes = 0;
  };
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    push(); // each source line starts a fresh chunk
    for (const ch of line) {
      // `for…of` iterates by code point, so surrogate pairs stay intact.
      const b = cpByteLen(ch.codePointAt(0)!);
      if (curBytes + b > 64) push();
      cur += ch;
      curBytes += b;
      if (chunks.length >= maxChunks) return chunks.slice(0, maxChunks);
    }
  }
  push();
  return chunks.slice(0, maxChunks);
}

/** Wrap a comment as the CIP-20 metadata object posted under label 674, or null for empty text. */
export function buildCip20Message(text: string): Record<string, { msg: string[] }> | null {
  const msg = cip20MessageChunks(text);
  return msg.length ? { [CIP20_MESSAGE_LABEL]: { msg } } : null;
}
