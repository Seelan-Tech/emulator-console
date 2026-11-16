// Subsequence fuzzy matching for the command palette: "s3bk" finds "S3 buckets". Returns null when the query
// isn't a subsequence of the text; otherwise a score (higher is better) and the matched positions for highlighting.
export type Match = { score: number; indices: number[] };

const isWordStart = (text: string, i: number) => {
  if (i === 0) return true;
  const prev = text[i - 1] ?? "";
  const cur = text[i] ?? "";
  // after a separator, or a lower→UPPER camel-case boundary
  return /[\s\-_/.:]/.test(prev) || (prev === prev.toLowerCase() && cur !== cur.toLowerCase());
};

export function fuzzy(query: string, text: string): Match | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const lower = text.toLowerCase();

  // A contiguous substring is always the best kind of match: prefer it (earlier and at a word start is better).
  const at = lower.indexOf(q);
  if (at >= 0) {
    const indices = Array.from({ length: q.length }, (_, k) => at + k);
    return { score: 1000 - at * 5 + (isWordStart(text, at) ? 200 : 0) - (text.length - q.length) * 0.5, indices };
  }

  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = lower.indexOf(ch, ti);
    if (found < 0) return null;
    score += 10;
    if (found === prev + 1) score += 15; // consecutive characters
    if (isWordStart(text, found)) score += 12;
    score -= Math.min(found - ti, 8); // penalize big gaps
    indices.push(found);
    prev = found;
    ti = found + 1;
  }
  return { score, indices };
}

// Best score across several fields; the label's indices are the ones that get highlighted.
export function fuzzyItem(query: string, label: string, ...extra: (string | undefined)[]): Match | null {
  const main = fuzzy(query, label);
  if (main) return main;
  for (const e of extra) {
    if (!e) continue;
    const m = fuzzy(query, e);
    if (m) return { score: m.score - 300, indices: [] }; // matched on a keyword, not on the visible label
  }
  return null;
}
