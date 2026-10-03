import {describe, expect, it} from 'vitest';
import {entryPosition, FADED_BAND, isLong, nextStep, type Span, type Viewport} from '../../src/state/longMessageGeometry';

// 600x600 conversation: 440 px of list between the header and the actions.
const HEIGHT = 440;
const view = (scrollTop: number, maxScrollTop = 6000): Viewport => ({scrollTop, clientHeight: HEIGHT, maxScrollTop});
// A long message that is neither the first nor the last one.
const middle: Span = {top: 2000, bottom: 4000};

/** Presses `direction` from `from` until the message's edge is clear; returns the positions. */
function readThrough(span: Span, direction: 'up' | 'down', from: number, maxScrollTop = 6000): number[] {
  const positions = [from];
  for (let next = nextStep(span, direction, from, view(from, maxScrollTop)); next != null; ) {
    positions.push(next);
    next = nextStep(span, direction, next, view(next, maxScrollTop));
    if (positions.length > 50) throw new Error('no end');
  }
  return positions;
}

describe('long messages', () => {
  it('counts as long only what cannot be shown whole', () => {
    expect(isLong(middle, view(0))).toBe(true);
    expect(isLong({top: 0, bottom: HEIGHT}, view(0))).toBe(false);
    expect(isLong({top: 0, bottom: 380}, view(0))).toBe(false);
  });

  it('opens at its start with Down and at its end with Up, clear of the faded bands', () => {
    expect(entryPosition(middle, 'down', view(0))).toBe(middle.top - FADED_BAND);
    expect(entryPosition(middle, 'up', view(0))).toBe(middle.bottom - (HEIGHT - FADED_BAND));
    // The first message opens at the very top; the last one at the very end.
    expect(entryPosition({top: 10, bottom: 2000}, 'down', view(0))).toBe(0);
    expect(entryPosition({top: 4000, bottom: 6400}, 'up', view(0))).toBe(6000);
  });

  it('Down scrolls through a middle message in half-screen steps and stops with its end in view', () => {
    const positions = readThrough(middle, 'down', entryPosition(middle, 'down', view(0)));
    expect(positions.length).toBeGreaterThan(5);
    const steps = positions.slice(1).map((position, index) => position - positions[index]);
    expect(steps.every(step => step > 0 && step <= HEIGHT / 2)).toBe(true);
    const end = positions.at(-1)!;
    expect(middle.bottom).toBe(end + HEIGHT - FADED_BAND);
    // Then the key goes on to the next message.
    expect(nextStep(middle, 'down', end, view(end))).toBeNull();
  });

  it('Up does the same in reverse and stops with its start in view', () => {
    const positions = readThrough(middle, 'up', entryPosition(middle, 'up', view(0)));
    expect(positions.length).toBeGreaterThan(5);
    const end = positions.at(-1)!;
    expect(middle.top).toBe(end + FADED_BAND);
    expect(nextStep(middle, 'up', end, view(end))).toBeNull();
  });

  it('stops at the ends of the list', () => {
    expect(nextStep({top: 10, bottom: 2000}, 'up', 0, view(0))).toBeNull();
    expect(nextStep({top: 4000, bottom: 6400}, 'down', 6000, view(6000))).toBeNull();
    // The last step of the last message reaches the end of the list exactly.
    const last = readThrough({top: 4000, bottom: 6400}, 'down', 3936);
    expect(last.at(-1)).toBe(6000);
  });

  it('leaves a message alone once its edge is clear', () => {
    // Its end already above the bottom band: Down goes on at once.
    expect(nextStep(middle, 'down', 3700, view(3700))).toBeNull();
    // Its start already below the top band: Up goes on at once.
    expect(nextStep(middle, 'up', 1900, view(1900))).toBeNull();
  });
});
