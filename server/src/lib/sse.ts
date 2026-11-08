import type { Response } from 'express';

export interface SseStream<T> {
  send: (event: T) => void;
  end: () => void;
  /** Aborted when the client goes away mid-stream, so upstream work can stop. */
  signal: AbortSignal;
}

/** Switches the response to Server-Sent Events. One JSON object per `data:` line. */
export function openSse<T>(res: Response): SseStream<T> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // stop nginx-style proxies from buffering the stream
  res.flushHeaders();

  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });

  return {
    send: event => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`); },
    end: () => { if (!res.writableEnded) res.end(); },
    signal: abort.signal
  };
}
