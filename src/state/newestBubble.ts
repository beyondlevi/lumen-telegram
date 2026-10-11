import type {KeyboardEvent} from 'react';

/** The newest bubble of a conversation's list (the focusable part of its last row). */
export function newestBubble(list: Element | null | undefined): HTMLElement | null {
  const rows = list?.querySelectorAll('.message-row');
  return rows?.[rows.length - 1]?.querySelector<HTMLElement>('[aria-haspopup="menu"]') ?? null;
}

/** Moves the focus from an older bubble of the list to the newest one. */
export function focusNewestBubble(list: HTMLElement | null | undefined) {
  const focused = document.activeElement;
  if (list == null || !(focused instanceof HTMLElement) || !list.contains(focused)) {
    return;
  }
  const newest = newestBubble(list);
  if (newest != null && !newest.contains(focused)) {
    newest.focus({preventScroll: true});
  }
}

/**
 * Up from the conversation's actions (Reply, Voice, Photo) goes to the newest
 * message. The toolkit picks the target of an arrow by geometry and prefers
 * what lies straight above the focused button: a newest bubble of yours
 * (right-aligned, narrow, such as a photo) whose bottom reaches the rail's top
 * edge lost to an older, wider bubble above Reply, which was skipped to.
 * Handled before the toolkit's own listener, which ignores a handled key.
 */
export function upToNewest(event: KeyboardEvent<HTMLElement>, list: Element | null | undefined) {
  if (event.key !== 'ArrowUp' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }
  if (!(event.target instanceof HTMLElement) || event.target.closest('textarea, input') != null) {
    return;
  }
  const newest = newestBubble(list);
  if (newest != null) {
    event.preventDefault();
    newest.focus({preventScroll: true});
  }
}
