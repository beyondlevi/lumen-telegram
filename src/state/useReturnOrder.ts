import {useEffect, useRef, useState} from 'react';
import type {Chat} from '../telegram/model';

/** Chats in a previous order; chats that were not there go last. */
function inOrder(chats: Chat[], order: string[]): Chat[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...chats].sort(
    (a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length),
  );
}

/**
 * Back restores focus by row position, so when the list comes back it keeps
 * the order it had when a chat was opened. The next refresh re-sorts the rows
 * (most recent first) and the focused row moves together with its chat.
 */
export function useReturnOrder(chats: Chat[], listOrder: {current: string[] | null}): Chat[] {
  const [frozenOrder, setFrozenOrder] = useState(() => listOrder.current);
  const chatsAtMount = useRef(chats);
  useEffect(() => {
    if (chats !== chatsAtMount.current) {
      setFrozenOrder(null);
    }
  }, [chats]);
  const rows = frozenOrder ? inOrder(chats, frozenOrder) : chats;
  useEffect(() => {
    listOrder.current = rows.map(chat => chat.id);
  });
  return rows;
}
