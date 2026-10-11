import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {Chat} from '../telegram/model';

/** Chats in a previous order; chats that were not there go last. */
function inOrder(chats: Chat[], order: string[]): Chat[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...chats].sort(
    (a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length),
  );
}

/**
 * The list stays mounted, hidden, while a chat is open. When it shows again it
 * keeps the order it had when it was hidden, so the rows are where the wearer
 * left them; the next refresh re-sorts them (most recent first) and the
 * focused row moves together with its chat.
 */
export function useReturnOrder(chats: Chat[], shown: boolean): Chat[] {
  const [frozenOrder, setFrozenOrder] = useState<string[] | null>(null);
  const rows = useMemo(() => (frozenOrder ? inOrder(chats, frozenOrder) : chats), [chats, frozenOrder]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  // The chats on screen when the list showed again; a newer list ends the freeze.
  const chatsWhenShown = useRef<Chat[] | null>(null);

  useLayoutEffect(() => {
    if (!shown) {
      chatsWhenShown.current = null;
      setFrozenOrder(rowsRef.current.map(chat => chat.id));
    }
  }, [shown]);
  useEffect(() => {
    if (!shown) {
      return;
    }
    if (chatsWhenShown.current == null) {
      chatsWhenShown.current = chats;
    } else if (chats !== chatsWhenShown.current) {
      chatsWhenShown.current = chats;
      setFrozenOrder(null);
    }
  }, [chats, shown]);
  return rows;
}
