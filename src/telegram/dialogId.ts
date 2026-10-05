// Telegram for Android names a chat notification's shortcut `ndid_<dialogId>`.
// Its dialog ids: a user is the user id (positive), a basic group is -chatId,
// and a channel or supergroup is -channelId, without the -100… prefix of the
// "marked" ids that GramJS (and this app's Chat.id) use.

/** The chat a notification points to; a negative dialog id may be a basic group or a channel/supergroup. */
export type NotificationDialog = {kind: 'user'; userId: string} | {kind: 'group'; id: string};

/** A peer to look up, as GramJS's PeerUser / PeerChat / PeerChannel. */
export type DialogPeer = {type: 'user' | 'chat' | 'channel'; id: string};

const SHORTCUT = /^ndid_(-?)([1-9][0-9]{0,15})$/;
/** Marked channel ids are -(10^12 + channelId). */
const CHANNEL_OFFSET = 1000000000000n;

/** The dialog of a notification shortcut (`ndid_8811522265`, `ndid_-1194773306`); null for anything else. */
export function parseShortcut(shortcut: string): NotificationDialog | null {
  const match = SHORTCUT.exec(shortcut.trim());
  if (match == null || BigInt(match[2]) > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return match[1] ? {kind: 'group', id: match[2]} : {kind: 'user', userId: match[2]};
}

/** Peers the dialog can be, in lookup order: supergroups and channels before basic groups. */
export function dialogPeers(dialog: NotificationDialog): DialogPeer[] {
  return dialog.kind === 'user'
    ? [{type: 'user', id: dialog.userId}]
    : [
        {type: 'channel', id: dialog.id},
        {type: 'chat', id: dialog.id},
      ];
}

/** The marked id of a peer, as GramJS's utils.getPeerId returns it. */
export function markedId(peer: DialogPeer): string {
  switch (peer.type) {
    case 'user':
      return peer.id;
    case 'chat':
      return `-${peer.id}`;
    case 'channel':
      return String(-(CHANNEL_OFFSET + BigInt(peer.id)));
  }
}

/** Chat ids (marked) the dialog can have. */
export function candidateChatIds(dialog: NotificationDialog): string[] {
  return dialogPeers(dialog).map(markedId);
}

/** The first chat of the list (most recent first) that is the dialog. */
export function findListedChat<T extends {id: string}>(dialog: NotificationDialog, chats: readonly T[]): T | undefined {
  const candidates = new Set(candidateChatIds(dialog));
  return chats.find(chat => candidates.has(chat.id));
}
