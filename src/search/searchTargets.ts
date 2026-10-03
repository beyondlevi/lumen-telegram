import type {NameCandidate} from './nameMatch';

/** A chat or contact that voice search can find. */
export type SearchTarget = {
  /** What the conversation route takes (WhatsApp JID, Telegram peer id). */
  id: string;
  name: string;
  phone: string | null;
  isGroup: boolean;
  /** Second line of a chat's row (its last message, as in the list). */
  detail: string | null;
  /** A chat of the list; otherwise a contact without a conversation yet. */
  inChats: boolean;
};

/** Recent chats first, then contacts, as the matcher's tie order. */
export function searchCandidates(targets: readonly SearchTarget[]): NameCandidate<SearchTarget>[] {
  return [...targets.filter(target => target.inChats), ...targets.filter(target => !target.inChats)].map(target => ({
    name: target.name,
    phone: target.phone,
    item: target,
  }));
}
