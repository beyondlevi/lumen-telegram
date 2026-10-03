// Finds chats and contacts by a spoken name. Speech recognition returns the
// name as heard: with or without accents, in any case, sometimes with one
// letter wrong ("Maia" for "Maya"), split or joined ("Ana Paula", "Anapaula"),
// wrapped in a few words ("chat with Ana"), or as the digits of a number.

export type NameCandidate<T> = {
  /** Display name of the chat or contact. */
  name: string;
  /** Phone number or other digits the wearer may say instead of the name. */
  phone?: string | null;
  item: T;
};

export type NameMatch<T> = {item: T; name: string; score: number};

/** Below this a candidate is not listed. */
export const MIN_SCORE = 0.5;
const MAX_RESULTS = 8;

// Words said around a name, in English and Portuguese ("open the chat with
// Ana", "conversa com a Ana"). They count when they match a name (a name may
// contain "de" or "da") and are not missed when they don't.
const FILLER = new Set([
  'a', 'an', 'the', 'to', 'with', 'for', 'and', 'open', 'chat', 'chats', 'conversation', 'message', 'messages',
  'search', 'find', 'call', 'contact', 'please',
  'o', 'os', 'as', 'e', 'de', 'da', 'do', 'das', 'dos', 'com', 'para', 'pra', 'pro', 'abrir', 'abre', 'abra',
  'conversa', 'conversar', 'mensagem', 'mensagens', 'procurar', 'procura', 'buscar', 'busca', 'falar', 'ligar',
  'contato', 'contacto', 'por', 'favor',
]);

/** Lower case, without accents or punctuation; words separated by one space. */
export function normalizeName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function words(text: string): string[] {
  const normalized = normalizeName(text);
  return normalized ? normalized.split(' ') : [];
}

/** Edit distance with adjacent transpositions (optimal string alignment), capped at `max` + 1. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) {
    return max + 1;
  }
  let previousPrevious: number[] = [];
  let previous = Array.from({length: b.length + 1}, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, previousPrevious[j - 2] + 1);
      }
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) {
      return max + 1;
    }
    previousPrevious = previous;
    previous = current;
  }
  return Math.min(previous[b.length], max + 1);
}

/** How well a spoken word matches a word of a name (0 = not at all). */
export function wordScore(spoken: string, word: string): number {
  if (spoken === word) {
    return 1;
  }
  if (spoken.length >= 2 && word.startsWith(spoken)) {
    // The start of the word ("Ma" for "Maya"); longer is surer.
    return spoken.length >= 3 ? 0.85 : 0.6;
  }
  if (spoken.length >= 3 && editDistance(spoken, word, 1) <= 1) {
    // One letter wrong, missing, extra or swapped.
    return 0.8;
  }
  if (spoken.length >= 4 && word.length > spoken.length && editDistance(spoken, word.slice(0, spoken.length), 1) <= 1) {
    return 0.65;
  }
  if (spoken.length >= 7 && editDistance(spoken, word, 2) <= 2) {
    return 0.6;
  }
  return 0;
}

/** Score of one name for what was said (0 when it does not match). */
export function nameScore(query: string, name: string, phone?: string | null): number {
  const spoken = words(query);
  const nameWords = words(name);
  let best = 0;

  const digits = query.replace(/\D/g, '');
  if (digits.length >= 4 && phone && phone.replace(/\D/g, '').includes(digits)) {
    best = 0.9;
  }
  if (spoken.length === 0 || nameWords.length === 0) {
    return best;
  }

  const meaningful = spoken.filter(word => !FILLER.has(word));
  const asked = meaningful.length > 0 ? meaningful : spoken;
  const nameMeaningful = nameWords.filter(word => !FILLER.has(word));
  const nameKey = nameMeaningful.length > 0 ? nameMeaningful : nameWords;

  // Each spoken word takes the best still free word of the name.
  const used = new Set<number>();
  let total = 0;
  let firstMatched = false;
  spoken.forEach(word => {
    let bestIndex = -1;
    let bestScore = 0;
    nameWords.forEach((candidate, index) => {
      if (used.has(index)) {
        return;
      }
      const score = wordScore(word, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    const counts = asked.includes(word);
    if (bestIndex >= 0 && (counts || bestScore === 1)) {
      used.add(bestIndex);
      if (counts) {
        total += bestScore;
        if (word === asked[0] && bestIndex === 0 && bestScore >= 0.8) {
          firstMatched = true;
        }
      }
    }
  });
  if (total > 0) {
    const coveredName = nameKey.filter(word => [...used].some(index => nameWords[index] === word)).length;
    const coverage = 0.85 + 0.15 * (coveredName / nameKey.length);
    best = Math.max(best, (total / asked.length) * coverage + (firstMatched ? 0.05 : 0));
  }

  // Said joined or split differently ("anapaula" / "Ana Paula Ribeiro").
  const joinedSpoken = asked.join('');
  if (joinedSpoken.length >= 4) {
    for (let count = nameKey.length; count >= 1; count -= 1) {
      const joinedName = nameKey.slice(0, count).join('');
      const whole = count === nameKey.length;
      if (joinedSpoken === joinedName) {
        best = Math.max(best, whole ? 1 : 0.9);
      } else if (editDistance(joinedSpoken, joinedName, 1) <= 1) {
        best = Math.max(best, whole ? 0.85 : 0.8);
      }
    }
  }
  return best;
}

/**
 * Candidates matching what was said, best first. Equal scores keep the
 * candidates' order (callers list recent chats first, then contacts).
 */
export function rankByName<T>(query: string, candidates: readonly NameCandidate<T>[], limit = MAX_RESULTS): NameMatch<T>[] {
  return candidates
    .map((candidate, index) => ({index, item: candidate.item, name: candidate.name, score: nameScore(query, candidate.name, candidate.phone)}))
    .filter(match => match.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({item, name, score}) => ({item, name, score}));
}
