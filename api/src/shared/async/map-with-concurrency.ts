/**
 * Map `items` through an async `task`, running at most `concurrency` tasks at once and preserving
 * input order in the result. The bound is what keeps fan-out work (e.g. one vision call per PDF
 * page) from hammering an external API; the first rejection aborts the whole map.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) continue; // sparse guard for noUncheckedIndexedAccess; never hit
      results[index] = await task(item);
    }
  });
  await Promise.all(workers);
  return results;
}
