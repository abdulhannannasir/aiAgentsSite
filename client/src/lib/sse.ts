/**
 * Reads a Server-Sent Events body and calls `onEvent` with each parsed JSON `data:` payload.
 * Tolerates events split across network chunks, CRLF line endings and malformed payloads (skipped).
 */
export async function readSSE<T>(body: ReadableStream<Uint8Array>, onEvent: (event: T) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flush = (block: string) => {
    const dataLines = block
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, ''));
    if (!dataLines.length) return;
    try {
      onEvent(JSON.parse(dataLines.join('\n')) as T);
    } catch {
      /* ignore a malformed event rather than killing the stream */
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';
    blocks.forEach(flush);
  }
  buffer += decoder.decode();
  if (buffer.trim()) flush(buffer);
}
