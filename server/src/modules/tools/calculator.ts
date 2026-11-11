import { z } from 'zod';
import { ToolError, type ToolDefinition } from './types.js';

/** Arithmetic with + - * / % ^, parentheses and unary minus, by a small recursive-descent parser (no eval). */
export function evaluate(expression: string): number {
  const s = expression.replace(/\s+/g, '');
  if (!s || s.length > 300 || !/^[0-9+\-*/%^().]+$/.test(s)) throw new ToolError('Use only numbers, + - * / % ^ and parentheses.');
  let i = 0;
  let depth = 0;
  const atom = (): number => {
    const c = s[i];
    if (c === '(') {
      if (++depth > 50) throw new ToolError('Too many nested parentheses.');
      i++;
      const v = sum();
      if (s[i] !== ')') throw new ToolError('Unbalanced parentheses.');
      i++;
      depth--;
      return v;
    }
    if (c === '-') { i++; return -atom(); }
    if (c === '+') { i++; return atom(); }
    const m = /^(\d+(\.\d+)?|\.\d+)/.exec(s.slice(i));
    if (!m) throw new ToolError(`Unexpected "${s[i] ?? 'end'}" at position ${i + 1}.`);
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const power = (): number => {
    const base = atom();
    if (s[i] === '^') { i++; return base ** power(); } // right-associative
    return base;
  };
  const product = (): number => {
    let v = power();
    while (s[i] === '*' || s[i] === '/' || s[i] === '%') {
      const op = s[i++];
      const r = power();
      if ((op === '/' || op === '%') && r === 0) throw new ToolError('Division by zero.');
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (s[i] === '+' || s[i] === '-') {
      const op = s[i++];
      const r = product();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const result = sum();
  if (i !== s.length) throw new ToolError(`Unexpected "${s[i]}" at position ${i + 1}.`);
  if (!Number.isFinite(result)) throw new ToolError('The result is not a finite number.');
  return result;
}

export const calculatorTool: ToolDefinition<{ expression: string }> = {
  id: 'calculator',
  label: 'Calculator',
  description: 'Evaluates an arithmetic expression exactly. Supports + - * / % ^ and parentheses. Use it for any calculation instead of doing math in your head.',
  parameters: { type: 'object', properties: { expression: { type: 'string', description: 'For example "(1200 * 0.15) / 12"' } }, required: ['expression'] },
  input: z.object({ expression: z.string().min(1).max(300) }),
  timeoutMs: 1000,
  untrustedOutput: false,
  availability: { available: true },
  async run({ expression }) {
    const v = evaluate(expression);
    return `${expression} = ${Number.isInteger(v) ? v : Number(v.toPrecision(12))}`;
  }
};
