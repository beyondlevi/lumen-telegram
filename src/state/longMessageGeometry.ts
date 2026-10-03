// Where the conversation list scrolls when a message taller than the visible
// area is read with the arrow keys (see useLongMessageScroll). Positions are in
// the list's content coordinates: 0 is the top of the content.

/** Height of the faded bands at the top and bottom of the list (its default). */
export const FADED_BAND = 64;
/** Share of the visible height scrolled by one key press inside a message. */
const STEP_FRACTION = 0.5;
const EPSILON = 0.5;

export type Direction = 'up' | 'down';

/** Vertical extent of a message. */
export type Span = {top: number; bottom: number};

/** Scroll state of the list. */
export type Viewport = {scrollTop: number; clientHeight: number; maxScrollTop: number};

const clamp = (value: number, viewport: Viewport) => Math.min(viewport.maxScrollTop, Math.max(0, value));

/** The message cannot be shown whole. */
export function isLong(span: Span, viewport: Viewport): boolean {
  return span.bottom - span.top > viewport.clientHeight + EPSILON;
}

/**
 * Scroll position for the next step through a long message from `from`, or
 * null when its edge in that direction is already clear (or the list cannot
 * scroll further), so the key goes on to the next message.
 */
export function nextStep(span: Span, direction: Direction, from: number, viewport: Viewport): number | null {
  const step = viewport.clientHeight * STEP_FRACTION;
  if (direction === 'down') {
    if (from >= viewport.maxScrollTop - EPSILON) {
      return null;
    }
    const readBottom = from + viewport.clientHeight - FADED_BAND;
    if (span.bottom <= readBottom + EPSILON) {
      return null;
    }
    return clamp(Math.min(from + step, span.bottom - (viewport.clientHeight - FADED_BAND)), viewport);
  }
  if (from <= EPSILON) {
    return null;
  }
  if (span.top >= from + FADED_BAND - EPSILON) {
    return null;
  }
  return clamp(Math.max(from - step, span.top - FADED_BAND), viewport);
}

/** Scroll position showing the start (reached with Down) or the end (with Up) of a long message. */
export function entryPosition(span: Span, direction: Direction, viewport: Viewport): number {
  return direction === 'down'
    ? clamp(span.top - FADED_BAND, viewport)
    : clamp(span.bottom - (viewport.clientHeight - FADED_BAND), viewport);
}

