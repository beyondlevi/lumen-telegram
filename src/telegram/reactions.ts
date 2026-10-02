import {sameEmoji} from './convert';
import type {AllowedReactions, ReactionSummary} from './model';

/**
 * The four menu reactions, each with the substitutes tried when the chat does
 * not accept the first one (Telegram's standard set has 🤣 and 😁 rather
 * than 😂 in some versions; 😢 stands in for 😭).
 */
export const REACTION_SLOTS: readonly (readonly string[])[] = [['👍'], ['❤'], ['😂', '🤣', '😁'], ['😭', '😢']];

export type ReactionOption = {emoji: string; allowed: boolean};

/** Menu reactions for a chat: the first accepted emoji of each slot, or the slot's first emoji marked not allowed. */
export function reactionOptions(allowed: AllowedReactions | null): ReactionOption[] {
  return REACTION_SLOTS.map(slot => {
    if (allowed == null || allowed.kind === 'all') {
      return {emoji: slot[0], allowed: true};
    }
    if (allowed.kind === 'none') {
      return {emoji: slot[0], allowed: false};
    }
    const match = slot.find(candidate => allowed.emojis.some(emoji => sameEmoji(emoji, candidate)));
    return match ? {emoji: match, allowed: true} : {emoji: slot[0], allowed: false};
  });
}

/** Your reaction replaced by `emoji` (or removed with null), counts adjusted. */
export function withMyReaction(reactions: ReactionSummary[] | undefined, emoji: string | null): ReactionSummary[] | undefined {
  const next: ReactionSummary[] = [];
  for (const reaction of reactions ?? []) {
    if (reaction.mine) {
      if (reaction.count > 1) {
        next.push({...reaction, count: reaction.count - 1, mine: false});
      }
    } else {
      next.push(reaction);
    }
  }
  if (emoji) {
    const existing = next.find(reaction => sameEmoji(reaction.emoji, emoji));
    if (existing) {
      existing.count += 1;
      existing.mine = true;
    } else {
      next.push({emoji, count: 1, mine: true});
    }
  }
  return next.length ? next : undefined;
}
