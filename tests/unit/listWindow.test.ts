import {describe, expect, it} from 'vitest';
import {FIRST_ROWS, MORE_ROWS, ROWS_AHEAD, rowsToRender} from '../../src/state/useListWindow';

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
