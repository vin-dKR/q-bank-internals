/** Decode NDJSON across arbitrary network/UTF-8 boundaries. False ends at a terminal event. */
export async function readJsonEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: unknown) => boolean,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ended = false;
  const deliver = (line: string): boolean => !line.trim() || onEvent(JSON.parse(line) as unknown);
  try {
    while (!ended) {
      const chunk = await reader.read();
      ended = chunk.done;
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let boundary = buffer.indexOf('\n');
      while (boundary >= 0) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        if (!deliver(line)) return;
        boundary = buffer.indexOf('\n');
      }
    }
    if (buffer.trim()) deliver(buffer);
  } finally {
    // Cleanup must not replace a validated result or the original read/validation error.
    if (!ended) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
