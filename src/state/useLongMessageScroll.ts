// Reading messages taller than the conversation's visible area with the arrow
// keys. While such a message is selected, Down/Up scroll through it until its
// bottom/top edge is clear of the faded bands, and only then go on to the next
// or previous message. A long message reached with Down opens at its start and
// one reached with Up at its end, so reading in either direction is continuous.
//
// The list scrolls on its own only past its first and last message, which is
// why this used to work for the newest message alone. The list also realigns
// the selected message: right away, again once its expansion settles, and
// whenever its own size changes. A long message cannot be aligned whole, so it
// jumped between its start and its end and lost the place being read. The
// place chosen here is kept, relative to the message, for as long as the
// message stays selected.

import {AnimationDurations, usePrefersReducedMotion} from '@wearables-ui-toolkit/mrbd';
import {useCallback, useEffect, useMemo, useRef, type FocusEvent, type KeyboardEvent, type RefObject} from 'react';
import {entryPosition, isLong, nextStep, type Direction, type Span, type Viewport} from './longMessageGeometry';

/** A direction key counts as the cause of the selection that follows within this time. */
const KEY_WINDOW_MS = 400;
/** Duration of one scroll step. */
const STEP_MS = AnimationDurations.CONTAINER_STATE_CHANGE_FAST_FOCUS + 100;
/** The list's realignment once a newly selected message has expanded. */
const SETTLE_MS =
  AnimationDurations.CONTAINER_FAST_MOVEMENT_EXPANSION_HESITATION_DELAY + AnimationDurations.CONTAINER_STATE_CHANGE;
/** The list's immediate realignment of a newly selected message, plus a few frames. */
const ENTRY_MS = AnimationDurations.CONTAINER_STATE_CHANGE_FAST_FOCUS + 120;

const BUBBLE_SELECTOR = '.message-stack > [aria-haspopup="menu"]';

function viewportOf(list: HTMLElement): Viewport {
  return {
    scrollTop: list.scrollTop,
    clientHeight: list.clientHeight,
    maxScrollTop: Math.max(0, list.scrollHeight - list.clientHeight),
  };
}

/** The bubble and its reaction badge, measured without the selection's scale. */
function spanOf(bubble: HTMLElement, list: HTMLElement): Span {
  const stack = bubble.parentElement ?? bubble;
  const rect = stack.getBoundingClientRect();
  const offset = list.scrollTop - list.getBoundingClientRect().top;
  return {top: rect.top + offset, bottom: rect.bottom + offset};
}

function bubbleIn(list: HTMLElement | null, target: EventTarget | null): HTMLElement | null {
  return list != null && target instanceof HTMLElement && list.contains(target) && target.matches(BUBBLE_SELECTOR)
    ? target
    : null;
}

const easeOut = (progress: number) => 1 - (1 - progress) ** 3;

const clampTo = (value: number, list: HTMLElement) => Math.min(Math.max(0, list.scrollHeight - list.clientHeight), Math.max(0, value));

/** Writes the scroll position chosen for one long message and keeps it while it is selected. */
function createHold() {
  let list: HTMLElement | null = null;
  let owner: HTMLElement | null = null;
  // Where the message's top sits above the top of the visible list, so the
  // place survives content above it changing height.
  let offset = 0;
  let from = 0;
  let to = 0;
  let start = 0;
  let duration = 0;
  let holdUntil = 0;
  let written = 0;
  let frame = 0;
  let settleTimer = 0;
  let settleFrame = 0;
  // Latest selection of a long message.
  let selected: HTMLElement | null = null;
  let selectedAt = -Infinity;

  const valueAt = (now: number) =>
    duration > 0 && now < start + duration ? from + (to - from) * easeOut((now - start) / duration) : to;

  const write = (value: number) => {
    if (list == null) {
      return;
    }
    list.scrollTop = value;
    written = list.scrollTop;
  };

  const tick = () => {
    frame = 0;
    if (owner == null) {
      return;
    }
    const now = performance.now();
    write(valueAt(now));
    if (now < holdUntil) {
      frame = window.requestAnimationFrame(tick);
    }
  };

  const release = () => {
    owner = null;
    holdUntil = 0;
    window.cancelAnimationFrame(frame);
    frame = 0;
  };

  return {
    release,
    /** The bubble whose place is kept. */
    owner: () => owner,
    /** Where the kept place is heading (the base for the next step). */
    target: () => to,
    /** The kept place of `bubble` as a position of the message's top. */
    offsetOf: (bubble: HTMLElement, scrollList: HTMLElement) => spanOf(bubble, scrollList).top - (owner === bubble ? to : scrollList.scrollTop),
    /**
     * Records that a long message has just been selected. Called while the
     * selection is handled, after the list armed its timer for the realignment
     * once the selection settles; the timer here has the same delay, so it runs
     * next and its frame callback after the list's: the place shown is the one kept.
     */
    select(bubble: HTMLElement) {
      if (owner !== bubble) {
        release();
      }
      window.clearTimeout(settleTimer);
      window.cancelAnimationFrame(settleFrame);
      selected = bubble;
      selectedAt = performance.now();
      settleTimer = window.setTimeout(() => {
        settleTimer = 0;
        settleFrame = window.requestAnimationFrame(() => {
          settleFrame = 0;
          if (owner === bubble && document.activeElement === bubble) {
            write(valueAt(performance.now()));
          }
        });
      }, SETTLE_MS);
    },
    /** Moves the list to `value` for `bubble` and keeps that place. */
    moveTo(scrollList: HTMLElement, bubble: HTMLElement, value: number, animate: boolean) {
      const now = performance.now();
      if (owner !== bubble || list !== scrollList) {
        release();
      }
      list = scrollList;
      owner = bubble;
      from = scrollList.scrollTop;
      to = clampTo(value, scrollList);
      offset = spanOf(bubble, scrollList).top - to;
      start = now;
      duration = animate ? STEP_MS : 0;
      // The list's first realignment animates over a few frames; writing on
      // each frame after it keeps it from showing.
      const realignedUntil = selected === bubble ? selectedAt + ENTRY_MS : 0;
      holdUntil = Math.max(holdUntil, now + duration + 60, realignedUntil);
      if (frame === 0) {
        tick();
      }
    },
    /** Puts back the kept place after a scroll not written here. */
    onScroll() {
      if (owner == null || list == null) {
        return;
      }
      if (!owner.isConnected || document.activeElement !== owner) {
        release();
        return;
      }
      if (Math.abs(list.scrollTop - written) <= 1) {
        return;
      }
      const now = performance.now();
      if (now >= start + duration) {
        to = clampTo(spanOf(owner, list).top - offset, list);
      }
      write(valueAt(now));
    },
  };
}

/**
 * Handlers for the element that holds the conversation list and the actions
 * below it, and `release()` for the page's own scrolling (revealing the newest
 * message), which must not be undone.
 */
export function useLongMessageScroll(listRef: RefObject<HTMLDivElement | null>) {
  const reducedMotion = usePrefersReducedMotion();
  const hold = useMemo(createHold, []);
  // Arrow key passed on to the list, which then selects the next message.
  const lastKeyRef = useRef<{direction: Direction; at: number} | null>(null);
  // Place in a long message that lost the selection to something outside the
  // list (its menu, a screen it opened), shown again when it comes back.
  const parkedRef = useRef<{bubble: HTMLElement; offset: number} | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list == null) {
      return;
    }
    const onScroll = () => hold.onScroll();
    // Scrolling by hand (wheel, touch) takes over.
    const byHand = () => hold.release();
    list.addEventListener('scroll', onScroll, {passive: true});
    list.addEventListener('wheel', byHand, {passive: true});
    list.addEventListener('touchstart', byHand, {passive: true});
    return () => {
      list.removeEventListener('scroll', onScroll);
      list.removeEventListener('wheel', byHand);
      list.removeEventListener('touchstart', byHand);
      hold.release();
    };
  }, [hold, listRef]);

  const onKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const direction: Direction | null = event.key === 'ArrowDown' ? 'down' : event.key === 'ArrowUp' ? 'up' : null;
      if (direction == null || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) {
        return;
      }
      const list = listRef.current;
      const bubble = bubbleIn(list, event.target);
      if (list != null && bubble != null) {
        const viewport = viewportOf(list);
        const span = spanOf(bubble, list);
        if (isLong(span, viewport)) {
          const from = hold.owner() === bubble ? hold.target() : viewport.scrollTop;
          const next = nextStep(span, direction, from, viewport);
          if (next != null) {
            event.preventDefault();
            event.stopPropagation();
            lastKeyRef.current = null;
            hold.moveTo(list, bubble, next, !reducedMotion);
            return;
          }
        }
      }
      hold.release();
      lastKeyRef.current = {direction, at: performance.now()};
    },
    [hold, listRef, reducedMotion],
  );

  const onFocus = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const list = listRef.current;
      const bubble = bubbleIn(list, event.target);
      if (list == null || bubble == null) {
        return;
      }
      const key = lastKeyRef.current;
      const parked = parkedRef.current;
      lastKeyRef.current = null;
      parkedRef.current = null;
      const viewport = viewportOf(list);
      const span = spanOf(bubble, list);
      if (!isLong(span, viewport)) {
        return;
      }
      hold.select(bubble);
      if (key != null && performance.now() - key.at <= KEY_WINDOW_MS) {
        hold.moveTo(list, bubble, entryPosition(span, key.direction, viewport), !reducedMotion);
      } else if (parked?.bubble === bubble) {
        hold.moveTo(list, bubble, span.top - parked.offset, false);
      }
    },
    [hold, listRef, reducedMotion],
  );

  const onBlur = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const list = listRef.current;
      const bubble = bubbleIn(list, event.target);
      if (list == null || bubble == null) {
        return;
      }
      const next = event.relatedTarget;
      const staysInList = next instanceof Node && list.contains(next);
      if (!staysInList && isLong(spanOf(bubble, list), viewportOf(list))) {
        parkedRef.current = {bubble, offset: hold.offsetOf(bubble, list)};
      }
      if (hold.owner() === bubble) {
        hold.release();
      }
    },
    [hold, listRef],
  );

  const release = useCallback(() => {
    hold.release();
    parkedRef.current = null;
  }, [hold]);

  return useMemo(() => ({handlers: {onKeyDownCapture, onFocus, onBlur}, release}), [onBlur, onFocus, onKeyDownCapture, release]);
}
