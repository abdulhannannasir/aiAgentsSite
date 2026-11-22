import { htmlToText } from '../tools/urlFetch.js';

/** Extracted text is capped: enough for real documents, bounded for storage and embedding cost. */
export const MAX_TEXT_CHARS = 400_000;

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'yml', 'yaml', 'log', 'ini', 'toml', 'sql', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'cs', 'php', 'sh', 'css', 'scss', 'html', 'htm', 'svg', 'rst', 'tex']);

export const extOf = (name: string) => (/\.([A-Za-z0-9]{1,10})$/.exec(name)?.[1] ?? '').toLowerCase();

export interface Extracted { text: string | null; reason?: string }

/** What a file's type can give: text for text-like files and PDFs; other files are stored but not searchable. */
export async function extractText(body: Buffer, mime: string, name: string): Promise<Extracted> {
  const ext = extOf(name);
  const isPdf = mime === 'application/pdf' || ext === 'pdf';
  if (isPdf) {
    if (body.subarray(0, 5).toString('latin1') !== '%PDF-') return { text: null, reason: 'The file is named as a PDF but is not one.' };
    try {
      const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
      const doc = await getDocumentProxy(new Uint8Array(body));
      const { text } = await pdfText(doc, { mergePages: true });
      const clean = String(text).replace(/[ \t]+\n/g, '\n').trim();
      return clean ? { text: clean.slice(0, MAX_TEXT_CHARS) } : { text: null, reason: 'The PDF has no extractable text (it may be scanned images).' };
    } catch {
      return { text: null, reason: 'The PDF could not be read.' };
    }
  }
  if (mime.startsWith('text/') || TEXT_EXT.has(ext) || mime === 'application/json' || mime === 'application/xml') {
    if (body.includes(0)) return { text: null, reason: 'The file looks binary, not text.' };
    let text = body.toString('utf8').replace(/^\uFEFF/, '');
    if (ext === 'html' || ext === 'htm' || mime === 'text/html') { const h = htmlToText(text); text = [h.title, h.text].filter(Boolean).join('\n\n'); }
    text = text.trim();
    return text ? { text: text.slice(0, MAX_TEXT_CHARS) } : { text: null, reason: 'The file is empty.' };
  }
  return { text: null, reason: 'Text is not extracted from this file type (supported: text, Markdown, CSV, JSON, HTML, code and PDF). It is stored and can be downloaded.' };
}

/**
 * Splits text into overlapping chunks of about `size` characters, preferring paragraph, then sentence, then word
 * boundaries, so each chunk is a readable passage for retrieval.
 */
export function chunkText(text: string, size = 1500, overlap = 200): string[] {
  const t = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length <= size) return t ? [t] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < t.length) {
    let end = Math.min(t.length, start + size);
    if (end < t.length) {
      const window = t.slice(start, end);
      const min = Math.floor(size * 0.5);
      const cut = Math.max(window.lastIndexOf('\n\n'), -1) >= min ? window.lastIndexOf('\n\n')
        : Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n')) >= min ? Math.max(window.lastIndexOf('. ') + 1, window.lastIndexOf('\n'))
        : window.lastIndexOf(' ') >= min ? window.lastIndexOf(' ') : window.length;
      end = start + cut;
    }
    const piece = t.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= t.length) break;
    start = Math.max(end - overlap, start + 1);
    // Start the overlap at a word boundary.
    const space = t.indexOf(' ', start);
    if (space > 0 && space < end) start = space + 1;
  }
  return chunks;
}
