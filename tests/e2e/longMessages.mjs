// Long messages in the conversation: the first, the third and the last of five
// are taller than the visible list. With the arrow keys, each one is read
// through (the list scrolls inside it) before the next or previous message is
// selected, in both directions, and the list never jumps away on the way.
// Shared by the WhatsApp and Telegram E2E runs; the caller opens the thread.
import assert from 'node:assert/strict';

const longText = tag =>
  Array.from({length: 30}, (_, index) => `${tag} line ${index + 1} of a very long message that keeps going.`).join(' ');

/** Messages of the test conversation, oldest first. */
export const LONG_THREAD = [longText('FIRST'), 'short one', longText('MIDDLE'), 'short two', longText('LAST')];
const LONG = new Set(['FIRST', 'MIDDLE', 'LAST']);

/** Starts recording every scroll position of the conversation list. */
async function recordScrolls(page) {
  await page.evaluate(() => {
    const list = document.querySelector('.message-list')?.closest('[data-scroll-view="true"]');
    if (!list) throw new Error('conversation list not found');
    window.__scrolls = [];
    list.addEventListener('scroll', () => window.__scrolls.push([performance.now(), list.scrollTop]), {passive: true});
  });
}

/** Selected message (by its tag) and where it and the list are. */
async function threadState(page) {
  return page.evaluate(() => {
    const list = document.querySelector('.message-list')?.closest('[data-scroll-view="true"]');
    const view = list.getBoundingClientRect();
    const focused = document.activeElement;
    const stack = focused?.closest?.('.message-stack');
    const rect = stack?.getBoundingClientRect();
    const label = focused?.getAttribute('aria-label') ?? focused?.textContent ?? '';
    const name = /FIRST|MIDDLE|LAST|short one|short two/.exec(label)?.[0] ?? label.trim().slice(0, 24);
    return {
      name,
      t: performance.now(),
      scrollTop: list.scrollTop,
      max: list.scrollHeight - list.clientHeight,
      viewTop: view.top,
      viewBottom: view.bottom,
      top: rect?.top ?? null,
      bottom: rect?.bottom ?? null,
    };
  });
}

const where = state =>
  `${state.name} scroll ${Math.round(state.scrollTop)}/${Math.round(state.max)}, bubble [${Math.round(state.top)}, ${Math.round(state.bottom)}] in view [${Math.round(state.viewTop)}, ${Math.round(state.viewBottom)}]`;

/**
 * Presses `key` until `done(state)` and checks every press. Returns the log and
 * the number of presses that scrolled inside each long message.
 */
async function readThrough(page, key, done, max = 80) {
  const down = key === 'ArrowDown';
  const steps = {FIRST: 0, MIDDLE: 0, LAST: 0};
  const entered = new Set();
  const log = [];
  let before = await threadState(page);
  for (let press = 0; press < max && !done(before); press += 1) {
    await page.evaluate(() => (window.__scrolls = []));
    await page.keyboard.press(key);
    // Longer than a scroll step; the second press after entering a long
    // message comes before the list's realignment at 800 ms.
    await page.waitForTimeout(450);
    const after = await threadState(page);
    const scrolls = await page.evaluate(() => window.__scrolls);
    log.push(`${key}: ${where(before)} -> ${where(after)}`);
    const context = `\n     ${log.slice(-4).join('\n     ')}`;

    // The list only moves between where it was and where it ends up.
    const low = Math.min(before.scrollTop, after.scrollTop) - 2;
    const high = Math.max(before.scrollTop, after.scrollTop) + 2;
    const jump = scrolls.find(([, top]) => top < low || top > high);
    assert.equal(jump, undefined, `the list jumped to ${jump?.[1]} on the way${context}`);

    if (LONG.has(before.name) && after.name === before.name) {
      // Still on the long message: the press scrolled inside it, and it fills the view.
      const moved = down ? after.scrollTop - before.scrollTop : before.scrollTop - after.scrollTop;
      const atEdge = down ? before.scrollTop >= before.max - 1 : before.scrollTop <= 1;
      assert.ok(moved > 1 || atEdge, `press scrolled inside ${before.name}${context}`);
      if (moved > 1) steps[before.name] += 1;
      assert.ok(after.top < after.viewBottom && after.bottom > after.viewTop, `${before.name} stays in view${context}`);
    }
    if (LONG.has(before.name) && after.name !== before.name) {
      // Left the long message only once its edge in that direction was in view.
      assert.ok(
        down ? before.bottom <= before.viewBottom + 1 : before.top >= before.viewTop - 1,
        `left ${before.name} before reaching its ${down ? 'end' : 'start'}${context}`,
      );
    }
    if (LONG.has(after.name) && after.name !== before.name) {
      // A long message reached with Down opens at its start, with Up at its end.
      entered.add(after.name);
      assert.ok(
        down ? after.top >= after.viewTop - 1 : after.bottom <= after.viewBottom + 1,
        `${after.name} opens at its ${down ? 'start' : 'end'}${context}`,
      );
    }
    before = after;
  }
  assert.ok(done(before), `stopped at ${where(before)} after ${max} presses\n     ${log.slice(-6).join('\n     ')}`);
  for (const name of LONG) {
    assert.ok(entered.has(name) || name === (down ? 'FIRST' : 'LAST'), `${name} reached with ${key}`);
    assert.ok(steps[name] >= 3, `${name}: ${steps[name]} presses scrolled inside it with ${key}\n     ${log.join('\n     ')}`);
  }
  return {log, steps};
}

/**
 * Runs the scenario in an open conversation with LONG_THREAD whose focus is on
 * Reply. `deliver(text)` makes a new message arrive in it. Returns the press
 * counts for the report.
 */
export async function longMessageScenario(page, {screenshot, deliver} = {}) {
  await recordScrolls(page);
  const start = await threadState(page);
  assert.equal(start.name, 'Reply', `starts on Reply: ${where(start)}`);

  // The report: Down on a long message that is not the last one went straight
  // to the next message. From "short one", Down selects MIDDLE; the next Downs
  // stay on it, scrolling, until its end is in view.
  for (let press = 0; press < 40 && (await threadState(page)).name !== 'short one'; press += 1) {
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(300);
  }
  assert.equal((await threadState(page)).name, 'short one');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(450);
  const middle = [await threadState(page)];
  assert.equal(middle[0].name, 'MIDDLE');
  while (middle.length < 30) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(450);
    const state = await threadState(page);
    if (state.name !== 'MIDDLE') break;
    middle.push(state);
  }
  const last = middle.at(-1);
  assert.ok(middle.length >= 4, `Down on MIDDLE scrolled inside it ${middle.length - 1} times before moving on (expected at least 3)\n     ${middle.map(where).join('\n     ')}`);
  assert.ok(last.bottom <= last.viewBottom + 1, `MIDDLE was left with its end out of view: ${where(last)}`);
  // Back to Reply for the full read-through.
  for (let press = 0; press < 40 && (await threadState(page)).top !== null; press += 1) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
  }
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(600);
  assert.equal((await threadState(page)).name, 'Reply');

  // Up from Reply to the top: LAST, short two, MIDDLE, short one, FIRST.
  const up = await readThrough(page, 'ArrowUp', state => state.name === 'FIRST' && state.scrollTop <= 1 && state.top >= state.viewTop - 1);
  if (screenshot) await screenshot('long-1-first-start');

  // Down to the actions below the list, reading MIDDLE (neither first nor last) top to bottom.
  const down = await readThrough(page, 'ArrowDown', state => state.top === null);

  // The menu of a long message keeps the place where the reading was.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(450);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(450);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(1000);
  const reading = await threadState(page);
  assert.equal(reading.name, 'LAST');
  assert.ok(reading.top < reading.viewTop && reading.bottom > reading.viewBottom, `in the middle of LAST: ${where(reading)}`);
  if (screenshot) await screenshot('long-2-last-middle');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  assert.ok(await page.evaluate(() => document.querySelector('.message-stack > [aria-expanded="true"]') != null), 'the message menu is open');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1300);
  const back = await threadState(page);
  assert.equal(back.name, 'LAST', 'the menu closes back to the message');
  assert.ok(Math.abs(back.scrollTop - reading.scrollTop) <= 2, `same place after the menu: ${where(reading)} -> ${where(back)}`);

  // A new message arriving below (the list grows) keeps the place too.
  if (deliver) {
    await deliver('short three');
    // Polling, not waitForFunction, so the module also runs under puppeteer (Chromium 95).
    for (let waited = 0; !(await page.evaluate(() => document.querySelector('.message-list')?.textContent?.includes('short three'))); waited += 250) {
      assert.ok(waited < 15000, 'the new message arrived');
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(1300);
    const grown = await threadState(page);
    assert.equal(grown.name, 'LAST', 'still on the long message after the new one arrived');
    assert.ok(grown.max > back.max + 10, `the list grew: ${where(back)} -> ${where(grown)}`);
    assert.ok(Math.abs(grown.top - back.top) <= 2, `same place after a new message: ${where(back)} -> ${where(grown)}`);
  }
  return {middleFromShortOne: middle.length - 1, up: up.steps, down: down.steps};
}
