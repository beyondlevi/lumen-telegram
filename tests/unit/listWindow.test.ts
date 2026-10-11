import {describe, expect, it} from 'vitest';
import {
  FIRST_MESSAGES,
  FIRST_ROWS,
  firstMessageIndex,
  messagesToRender,
  MORE_MESSAGES,
  MORE_ROWS,
  ROWS_AHEAD,
  rowsToRender,
} from '../../src/state/useListWindow';

const ids = (count: number) => Array.from({length: count}, (_, index) => `m${index}`);

describe('chat list window', () => {
  it('renders the first rows only, then more as the focus gets near the last one', () => {
    expect(rowsToRender(FIRST_ROWS, 0, 160)).toBe(FIRST_ROWS);
    expect(rowsToRender(FIRST_ROWS, FIRST_ROWS - ROWS_AHEAD - 1, 160)).toBe(FIRST_ROWS);
    expect(rowsToRender(FIRST_ROWS, FIRST_ROWS - ROWS_AHEAD, 160)).toBe(FIRST_ROWS + MORE_ROWS);
  });

  it('keeps ROWS_AHEAD past a focus far below the window (the row Back returns to)', () => {
    const count = rowsToRender(FIRST_ROWS, 40, 160);
    expect(count).toBeGreaterThan(40 + ROWS_AHEAD);
    expect(count).toBeLessThanOrEqual(40 + ROWS_AHEAD + MORE_ROWS);
  });

  it('never renders more rows than there are, nor fewer than it already has', () => {
    expect(rowsToRender(FIRST_ROWS, 5, 6)).toBe(6);
    expect(rowsToRender(40, 0, 160)).toBe(40);
  });
});

describe('conversation window', () => {
  it('renders the newest messages first', () => {
    expect(firstMessageIndex(ids(30), undefined)).toBe(30 - FIRST_MESSAGES);
    expect(firstMessageIndex(ids(5), undefined)).toBe(0);
  });

  it('keeps everything from the oldest message rendered, and the newest ones at least', () => {
    expect(firstMessageIndex(ids(30), 'm4')).toBe(4);
    expect(firstMessageIndex(ids(30), 'm29')).toBe(30 - FIRST_MESSAGES);
  });

  it('renders them all when the oldest one rendered is no longer loaded', () => {
    expect(firstMessageIndex(ids(30), 'gone')).toBe(0);
  });

  it('adds older messages as the focus gets near the oldest one rendered', () => {
    expect(messagesToRender(18, 29)).toBe(18);
    expect(messagesToRender(18, 22)).toBe(18 - MORE_MESSAGES);
    expect(messagesToRender(4, 6)).toBe(0);
  });
});
