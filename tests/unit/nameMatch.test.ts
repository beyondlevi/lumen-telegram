import {describe, expect, it} from 'vitest';
import {editDistance, nameScore, normalizeName, rankByName, wordScore, type NameCandidate} from '../../src/search/nameMatch';

const people: NameCandidate<string>[] = [
  {name: 'Ana Souza', item: 'ana'},
  {name: 'Mariana Lopes', item: 'mariana'},
  {name: 'João Gonçalves', item: 'joao'},
  {name: 'Carla Dias', item: 'carla'},
  {name: 'Família', item: 'familia'},
  {name: 'Ana Paula Ribeiro', item: 'anapaula'},
  {name: 'Maya Chen', item: 'maya'},
  {name: 'Diego Alves', item: 'diego'},
  {name: 'Anabela', item: 'anabela'},
  {name: '+55 11 99999-0007', phone: '+5511999990007', item: 'number'},
];

const top = (query: string) => rankByName(query, people).map(match => match.item);

describe('normalizeName', () => {
  it('drops accents, case and punctuation', () => {
    expect(normalizeName('  João   GONÇALVES! ')).toBe('joao goncalves');
    expect(normalizeName('Família—Lopes')).toBe('familia lopes');
    expect(normalizeName("D'Ávila")).toBe('d avila');
  });
});

describe('editDistance', () => {
  it('counts one wrong, missing, extra or swapped letter as one', () => {
    expect(editDistance('maia', 'maya')).toBe(1);
    expect(editDistance('carl', 'carla')).toBe(1);
    expect(editDistance('carlla', 'carla')).toBe(1);
    expect(editDistance('crala', 'carla')).toBe(1);
    expect(editDistance('diego', 'diego')).toBe(0);
    expect(editDistance('abcdef', 'uvwxyz', 1)).toBe(2);
  });
});

describe('wordScore', () => {
  it('ranks exact over prefix over one-letter mistakes', () => {
    expect(wordScore('ana', 'ana')).toBe(1);
    expect(wordScore('mari', 'mariana')).toBeGreaterThan(wordScore('maia', 'maya'));
    expect(wordScore('maia', 'maya')).toBeGreaterThan(0);
    expect(wordScore('an', 'ana')).toBeGreaterThan(0);
    expect(wordScore('x', 'xavier')).toBe(0);
    expect(wordScore('bruno', 'carla')).toBe(0);
  });
});

describe('rankByName', () => {
  it('lists the spoken name first, without accents or case', () => {
    expect(top('joao goncalves')[0]).toBe('joao');
    expect(top('JOÃO')[0]).toBe('joao');
    expect(top('familia')[0]).toBe('familia');
    expect(top('Diego')[0]).toBe('diego');
  });

  it('tolerates one wrong letter', () => {
    expect(top('Maia')[0]).toBe('maya');
    expect(top('Carla Diaz')[0]).toBe('carla');
    expect(top('Diogo')[0]).toBe('diego');
    expect(top('Joao Gonsalves')[0]).toBe('joao');
  });

  it('prefers the exact first name over longer names that contain it', () => {
    const ranked = top('Ana');
    expect(ranked[0]).toBe('ana');
    expect(ranked).toContain('anapaula');
    expect(ranked).toContain('anabela');
    expect(ranked).not.toContain('mariana');
  });

  it('matches several words and joined words', () => {
    expect(top('Ana Paula')[0]).toBe('anapaula');
    expect(top('anapaula')[0]).toBe('anapaula');
    expect(top('Ana Souza')[0]).toBe('ana');
  });

  it('ignores the words around the name', () => {
    expect(top('conversa com a Carla')[0]).toBe('carla');
    expect(top('open the chat with Maya')[0]).toBe('maya');
    expect(top('abrir a Família')[0]).toBe('familia');
  });

  it('finds a number by its digits', () => {
    expect(top('99999 0007')[0]).toBe('number');
  });

  it('returns nothing for an unknown name', () => {
    expect(top('Bruno')).toEqual([]);
    expect(top('')).toEqual([]);
    expect(top('com a')).toEqual([]);
  });

  it('keeps the given order between equal scores (recent chats first)', () => {
    const twins: NameCandidate<string>[] = [
      {name: 'Ana Souza', item: 'chat'},
      {name: 'Ana Souza', item: 'contact'},
    ];
    expect(rankByName('ana souza', twins).map(match => match.item)).toEqual(['chat', 'contact']);
  });

  it('scores a full name above a first name only', () => {
    expect(nameScore('Ana Souza', 'Ana Souza')).toBeGreaterThan(nameScore('Ana', 'Ana Souza'));
  });
});
