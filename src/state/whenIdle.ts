/** Runs `callback` when the page is idle, `latestMs` at the latest; returns its cancel. */
export function whenIdle(callback: () => void, latestMs = 300): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(callback, {timeout: latestMs});
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(callback, 50);
  return () => clearTimeout(id);
}
