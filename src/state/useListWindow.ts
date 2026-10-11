import {useCallback, useEffect, useRef, useState} from 'react';
import {whenIdle} from './whenIdle';

// Long lists render in windows: at first the rows that fit the 600 x 600 page
// plus a margin, then more as the focus gets near the last one rendered. On
// the glasses' CPU every row costs a mount (its layout, its drawn surface, its
// picture), so a list of 150 chats never renders them all at once.

/** Rows rendered at first: about 4 fit the page, the rest is margin. */
export const FIRST_ROWS = 16;
/** Rows kept rendered past the focused one. */
export const ROWS_AHEAD = 8;
/** Rows added at a time. */
export const MORE_ROWS = 8;

/** Rows to render with the focus on row `index`: at least ROWS_AHEAD past it, grown MORE_ROWS at a time. */
export function rowsToRender(rendered: number, index: number, total: number): number {
  let next = Math.max(rendered, FIRST_ROWS);
  while (next < total && index + ROWS_AHEAD >= next) {
    next += MORE_ROWS;
  }
  return Math.min(next, total);
}

/**
 * How many of `total` rows to render. `focused(index)` reports the focused
 * row: the rows past it are added in idle time, or at once when the focus is
 * on the last row rendered. `atLeast` rows are rendered now (the row that gets
 * the focus back).
 */
export function useListWindow(total: number, atLeast = 0): {count: number; focused(index: number): void} {
  const [rendered, setRendered] = useState(FIRST_ROWS);
  const count = Math.min(total, Math.max(rendered, atLeast));
  const latest = useRef({count, total});
  latest.current = {count, total};
  const cancelGrow = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelGrow.current?.(), []);
  useEffect(() => {
    if (count > rendered) {
      setRendered(count);
    }
  }, [count, rendered]);

  const focused = useCallback((index: number) => {
    const current = latest.current.count;
    const next = rowsToRender(current, index, latest.current.total);
    if (next <= current) {
      return;
    }
    cancelGrow.current?.();
    const grow = () => {
      cancelGrow.current = null;
      setRendered(previous => Math.max(previous, next));
    };
    if (index >= current - 1) {
      grow();
    } else {
      cancelGrow.current = whenIdle(grow);
    }
  }, []);

  return {count, focused};
}
