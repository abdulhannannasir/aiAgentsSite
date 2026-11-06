/**
 * Small fuzzy matcher for the command palette and the slash menu.
 * Returns 0 for "no match", otherwise a higher number for a better match.
 * Every whitespace-separated term in the query must match (AND), so "switch code" finds "Switch to Coding Assistant".
 */
export function scoreMatch(query: string, text: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 1;
  const hay = text.toLowerCase();
  const bare = hay.replace(/^[^a-z0-9]+/, ''); // "/research" counts as starting with "res"
  let total = 0;
  for (const term of terms) {
    const s = scoreTerm(term, hay, bare);
    if (s === 0) return 0;
    total += s;
  }
  return total / terms.length;
}

function scoreTerm(term: string, hay: string, bare: string): number {
  if (hay.startsWith(term) || bare.startsWith(term)) return 100;
  const wordStart = new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}`).test(hay);
  if (wordStart) return 80;
  if (hay.includes(term)) return 60;
  // subsequence match ("cdrv" -> "code review"), weaker
  let i = 0;
  for (const ch of hay) if (ch === term[i]) i++;
  return i === term.length ? 30 : 0;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function rankBy<T>(items: T[], query: string, textOf: (item: T) => string): T[] {
  if (!query.trim()) return items;
  return items
    .map((item, index) => ({ item, index, score: scoreMatch(query, textOf(item)) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(r => r.item);
}
