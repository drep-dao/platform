/**
 * A tiny, dependency-free, XSS-safe Markdown → HTML renderer.
 *
 * We deliberately avoid pulling in a markdown library (see the project's
 * dependency-version lesson). This supports the subset the proposal editor's
 * toolbar produces — headings, bold, italic, inline code, links, and bullet /
 * numbered lists — and nothing else.
 *
 * Safety: the source is HTML-escaped FIRST, so user text can never inject tags.
 * The only HTML in the output is what this function emits, and link hrefs are
 * restricted to http(s)/mailto (no `javascript:` URIs).
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LINK_ATTRS = 'target="_blank" rel="noopener noreferrer" class="text-emerald-600 underline"';

/** Autolink bare http(s) URLs in a fragment that holds no anchor tags yet. A URL runs until
 *  whitespace, '<', or a closing ')'; trailing sentence punctuation is kept outside the link. */
function autolinkBare(s: string): string {
  return s.replace(/https?:\/\/[^\s<)]+/g, (m) => {
    const trail = m.match(/[.,;:!?]+$/)?.[0] ?? '';
    const url = trail ? m.slice(0, -trail.length) : m;
    return `<a href="${url}" ${LINK_ATTRS}>${url}</a>${trail}`;
  });
}

/** Inline spans, applied to already-escaped text. Order matters (bold before italic). */
function inline(s: string): string {
  let t = s;
  // [text](url) — sanitize the href to http(s)/mailto only.
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    let safe = /^(https?:\/\/|mailto:)/i.test(url) ? url : '#';
    // Tolerate a mis-pasted link whose href is just a bare scheme ("https://") while the visible
    // text is the real URL — a common paste error — by using the text as the destination.
    const txt = text.trim();
    if (/^https?:\/\/$/i.test(safe) && /^https?:\/\/\S+$/i.test(txt)) safe = txt;
    return `<a href="${safe}" ${LINK_ATTRS}>${text}</a>`;
  });
  // A bare URL (not written as a [text](url) link) is still clickable. Split on the anchors just
  // produced so their hrefs aren't re-linked, and autolink only the gaps between them.
  t = t.split(/(<a\b[^>]*>.*?<\/a>)/g).map((seg, i) => (i % 2 === 0 ? autolinkBare(seg) : seg)).join('');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, '$1<em>$2</em>');
  t = t.replace(/\b_([^_]+)_\b/g, '<em>$1</em>');
  t = t.replace(/`([^`]+)`/g, '<code class="rounded bg-neutral-100 px-1 text-[0.9em] dark:bg-neutral-800">$1</code>');
  return t;
}

const H_CLASS: Record<string, string> = {
  h2: 'mt-3 text-base font-semibold',
  h3: 'mt-3 text-sm font-semibold',
  h4: 'mt-2 text-sm font-medium',
};

// ── GFM pipe tables ───────────────────────────────────────────────────────────
/** Split a table row into trimmed cells, dropping the optional outer pipes. */
function splitRow(raw: string): string[] {
  return raw.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}
/** A delimiter row is `| :--- | ---: | … |` — every cell is dashes with optional colons. */
function isDelimiterRow(raw: string | undefined): boolean {
  if (!raw || !raw.includes('-') || !raw.includes('|')) return false;
  const cells = splitRow(raw);
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}
const alignClass = (cell: string): string => {
  const l = cell.startsWith(':');
  const r = cell.endsWith(':');
  return l && r ? ' text-center' : r ? ' text-right' : l ? ' text-left' : '';
};
function renderTable(header: string[], aligns: string[], rows: string[][]): string {
  const cell = (tag: 'th' | 'td', text: string, i: number) => {
    const base = tag === 'th' ? 'border border-neutral-300 px-2 py-1 font-semibold dark:border-neutral-700' : 'border border-neutral-300 px-2 py-1 dark:border-neutral-700';
    return `<${tag} class="${base}${aligns[i] ?? ''}">${inline(text)}</${tag}>`;
  };
  const head = `<tr>${header.map((c, i) => cell('th', c, i)).join('')}</tr>`;
  const body = rows.map((r) => `<tr>${r.map((c, i) => cell('td', c, i)).join('')}</tr>`).join('');
  return `<div class="my-2 overflow-x-auto"><table class="w-full border-collapse text-sm"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/** Render a markdown string to a safe HTML string. */
export function renderMarkdown(src: string): string {
  // Honour markdown backslash-escapes for punctuation (e.g. Google Docs exports "11\." / "\|" / "\[").
  // Exclude * _ ` so inline emphasis/code still works as before.
  const unescaped = (src ?? '').replace(/\\([.[\]()|<>&"#+!{}~=-])/g, '$1');
  const lines = escapeHtml(unescaped).split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join('<br/>'))}</p>`);
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '');
    // GFM table: a row with pipes immediately followed by a delimiter row.
    if (line.includes('|') && isDelimiterRow(lines[i + 1])) {
      flushPara();
      closeList();
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(alignClass);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '') {
        rows.push(splitRow(lines[j]));
        j++;
      }
      out.push(renderTable(header, aligns, rows));
      i = j - 1;
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      const tag = h[1].length === 1 ? 'h2' : h[1].length === 2 ? 'h3' : 'h4';
      out.push(`<${tag} class="${H_CLASS[tag]}">${inline(h[2])}</${tag}>`);
    } else if (ul) {
      flushPara();
      if (list !== 'ul') {
        closeList();
        out.push('<ul class="my-1 list-disc pl-5">');
        list = 'ul';
      }
      out.push(`<li>${inline(ul[1])}</li>`);
    } else if (ol) {
      flushPara();
      if (list !== 'ol') {
        closeList();
        out.push('<ol class="my-1 list-decimal pl-5">');
        list = 'ol';
      }
      out.push(`<li>${inline(ol[1])}</li>`);
    } else if (line.trim() === '') {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join('\n');
}
