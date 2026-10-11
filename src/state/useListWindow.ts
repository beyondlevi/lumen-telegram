import {useCallback, useEffect, useRef, useState, type FocusEvent} from 'react';
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

/** Messages rendered at first, the newest: about 3 fit the page, the rest is margin. */
export const FIRST_MESSAGES = 12;
/** Messages kept rendered above the focused one. */
export const MESSAGES_AHEAD = 4;
/** Messages added at a time. */
export const MORE_MESSAGES = 8;

// The oldest message rendered in a conversation that opened one of its pages
// (a photo, the recorder, a transcript), so that Back renders the same
// messages and the focus comes back to the same one.
const keptOldest = new Map<string, string>();

/**
 * Index of the oldest message to render: the newest FIRST_MESSAGES at least,
 * and everything from `oldest` on. An `oldest` that is no longer loaded (older
 * messages dropped off) renders them all.
 */
export function firstMessageIndex(ids: readonly string[], oldest: string | undefined): number {
  const latest = Math.max(0, ids.length - FIRST_MESSAGES);
  if (oldest == null) {
    return latest;
  }
  const index = ids.indexOf(oldest);
  return Math.min(index < 0 ? 0 : index, latest);
}

/** Index of the oldest message to render with the focus on message `index`. */
export function messagesToRender(first: number, index: number): number {
  let next = first;
  while (next > 0 && index - MESSAGES_AHEAD <= next) {
    next -= MORE_MESSAGES;
  }
  return Math.max(0, next);
}

/**
 * Which of a conversation's messages (`ids`, oldest first) to render: from
 * `first` on. `onFocusCapture` goes on the conversation and follows the
 * focused message (an element with `data-message={id}`): older messages are
 * added in idle time, or at once when the focus is on the oldest rendered.
 * `keep()` before opening one of the conversation's pages.
 */
export function useMessageWindow(
  conversation: string,
  ids: readonly string[],
): {first: number; onFocusCapture(event: FocusEvent): void; keep(): void} {
  const [oldest, setOldest] = useState(() => {
    const kept = keptOldest.get(conversation);
    keptOldest.delete(conversation);
    return kept;
  });
  const first = firstMessageIndex(ids, oldest);
  const latest = useRef({first, ids});
  latest.current = {first, ids};
  const cancelGrow = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelGrow.current?.(), []);

  const focused = useCallback((index: number) => {
    const current = latest.current.first;
    const next = messagesToRender(current, index);
    if (next >= current) {
      return;
    }
    cancelGrow.current?.();
    const grow = () => {
      cancelGrow.current = null;
      setOldest(latest.current.ids[next]);
    };
    if (index <= current) {
      grow();
    } else {
      cancelGrow.current = whenIdle(grow);
    }
  }, []);
  const onFocusCapture = useCallback(
    (event: FocusEvent) => {
      const id = event.target instanceof Element ? event.target.closest('[data-message]')?.getAttribute('data-message') : null;
      const index = id == null ? -1 : latest.current.ids.indexOf(id);
      if (index >= 0) {
        focused(index);
      }
    },
    [focused],
  );
  const keep = useCallback(() => {
    const id = latest.current.ids[latest.current.first];
    if (id != null) {
      keptOldest.set(conversation, id);
    }
  }, [conversation]);

  return {first, onFocusCapture, keep};
}
