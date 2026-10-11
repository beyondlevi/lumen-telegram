// Times the list <-> conversation round trip on a slow CPU, the way the glasses
// feel it: Chromium with its CPU throttled (6x by default), a 600x600 viewport
// and a long chat list from the scripted Telegram of the E2E build.
//
//   npm run build:e2e && node tests/perf/navigation.mjs
//   PERF_CPU=4 PERF_CHATS=160 PERF_RUNS=5 node tests/perf/navigation.mjs
//   PERF_OUT=out.json (writes every sample), PERF_SHOTS=<dir> (screenshots after Back)
//
// Then, in a conversation, it takes a photo (the file chooser gets
// tests/fixtures/camera.jpg) and times Back from its send screen
// (`photoBack*`).
//
// For each key it records, from the key's event time to the end of a frame
// (its style, layout and paint included): `ready`, the first frame with the
// target screen in the page (the work the key started is done); `first`, the
// first frame where it is drawn at all; `full`, the first frame where it is
// fully drawn on top, with the other screen gone (page transitions included);
// and `busy`, the main thread's long tasks in the 2.5 s after the key. Launch: from the start of navigation to the first frame
// with the list fully drawn (`launchMs`), and the long tasks of the first 8 s
// (`launchBusyMs`, ending at `launchIdleMs`).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {NO_NATIVE_SPEECH} from '../e2e/fakeSpeech.mjs';
import {startStaticServer} from '../e2e/static-server.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
/** A photo as Lumen's capture screen hands it over (JPEG, 1200 x 1600). */
const PHOTO = path.join(root, 'tests/fixtures/camera.jpg');
const APP = 'http://127.0.0.1:4174';
const CPU = Number(process.env.PERF_CPU ?? 6);
const CHATS = Number(process.env.PERF_CHATS ?? 160);
const RUNS = Number(process.env.PERF_RUNS ?? 5);
const LAUNCHES = Number(process.env.PERF_LAUNCHES ?? 3);
/** The chat that is opened: an older one with a full page of messages, a few rows down. */
const TARGET = new RegExp(`^${process.env.PERF_TARGET ?? 'Contact 2'},`);

/** A row of the list (the launch counts the list as drawn when one is fully drawn on screen). */
const CHAT_ROW = '[role="button"][aria-label]';

/** A StringSession in GramJS's layout with a random key (the scripted Telegram never checks it): not a credential. */
function fakeSession() {
  const address = Buffer.from('149.154.167.51');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(address.length);
  const port = Buffer.alloc(2);
  port.writeUInt16BE(443);
  return `1${Buffer.concat([Buffer.from([2]), length, address, port, crypto.randomBytes(256)]).toString('base64')}`;
}

/** window.lumen with an account's settings, and the scripted Telegram with CHATS more chats. */
const LUMEN_SCRIPT = `(() => {
  sessionStorage.setItem('fake-telegram-init', ${JSON.stringify(JSON.stringify({extraChats: CHATS}))});
  const values = ${JSON.stringify({'telegram.apiId': '12345', 'telegram.apiHash': '0123456789abcdef0123456789abcdef', 'telegram.session': fakeSession()})};
  window.lumen = {config: {get: async () => ({...values}), onChange: () => () => {}}};
})();`;

// Long tasks from the start of the page; and a frame watcher the script arms before each key.
const PAGE_SCRIPT = `(() => {
  const ROW = ${JSON.stringify(CHAT_ROW)};
  window.__longTasks = [];
  try {
    new PerformanceObserver(list => window.__longTasks.push(...list.getEntries().map(e => [e.startTime, e.duration])))
      .observe({type: 'longtask', buffered: true});
  } catch {}
  const opacity = element => {
    let value = 1;
    for (let node = element; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return 0;
      value *= Number(style.opacity);
    }
    return value;
  };
  // Whether \`a\` is drawn above \`b\`: by z-index, then document order, where their ancestors part.
  // (Hit testing can't tell: it skips inert pages, such as one that has just come back.)
  const zIndex = element => {
    const style = getComputedStyle(element);
    return style.position !== 'static' && style.zIndex !== 'auto' ? Number(style.zIndex) : 0;
  };
  const above = (a, b) => {
    if (a.contains(b) || b.contains(a)) return true;
    const chain = element => { const list = []; for (let node = element; node; node = node.parentElement) list.unshift(node); return list; };
    const ca = chain(a), cb = chain(b);
    let i = 0;
    while (ca[i] === cb[i]) i += 1;
    const za = zIndex(ca[i]), zb = zIndex(cb[i]);
    return za !== zb ? za > zb : Boolean(cb[i].compareDocumentPosition(ca[i]) & Node.DOCUMENT_POSITION_FOLLOWING);
  };
  const onScreen = element => {
    const box = element.getBoundingClientRect();
    return box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
  };
  // How much of the element shows: its opacity, if it is on screen and no visible \`others\` element is drawn above it.
  const shows = (element, others) =>
    onScreen(element) && others.every(other => !onScreen(other) || opacity(other) < 0.01 || above(element, other)) ? opacity(element) : 0;
  const drawn = (selector, otherSelector) => {
    const others = otherSelector ? [...document.querySelectorAll(otherSelector)] : [];
    return Math.max(0, ...[...document.querySelectorAll(selector)].map(element => shows(element, others)));
  };
  window.__drawn = drawn;
  // Calls back once the current frame is rendered: a message posted from an animation frame is handled after it.
  const afterFrame = callback => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => callback(performance.now());
    channel.port2.postMessage(0);
  };
  // Launch: the first frame, from navigation start, with a chat row fully drawn.
  const launch = () => {
    if (drawn(ROW) > 0.99) afterFrame(time => { window.__launch = time; });
    else requestAnimationFrame(launch);
  };
  requestAnimationFrame(launch);
  // Resolves the frames where 'show' is first drawn and where it is fully drawn with 'hide' gone.
  window.__watch = (key, show, hide) => {
    const mark = {key: null, ready: null, first: null, full: null};
    window.__mark = mark;
    addEventListener('keydown', event => { if (event.key === key && mark.key == null) mark.key = event.timeStamp; }, {capture: true});
    // The frame's own timestamp can be older than the work done before it, so
    // the time is read once the frame is rendered; -1 marks a frame on its way.
    const at = name => afterFrame(time => { mark[name] = time - mark.key; });
    const tick = () => {
      if (mark.key != null) {
        const shown = drawn(show, hide);
        const hidden = hide ? drawn(hide, show) : 0;
        if (mark.ready == null && document.querySelector(show) != null) { mark.ready = -1; at('ready'); }
        if (mark.first == null && shown > 0.01) { mark.first = -1; at('first'); }
        if (mark.full == null && shown > 0.99 && hidden < 0.01) { mark.full = -1; at('full'); }
      }
      if (mark.full == null) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
})();`;

const median = values => {
  const sorted = values.filter(value => value != null).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
};

async function activeLabel(page) {
  return page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '(none)');
}

async function busySince(page, since, windowMs = 2500) {
  await page.waitForTimeout(windowMs);
  return page.evaluate(([from, to]) => Math.round(window.__longTasks
    .filter(([start]) => start >= from && start < to)
    .reduce((sum, [, duration]) => sum + duration, 0)), [since, since + windowMs]);
}

async function timeKey(page, key, show, hide) {
  await page.evaluate(([k, s, h]) => window.__watch(k, s, h), [key, show, hide]);
  await page.keyboard.press(key);
  await page.waitForFunction(() => window.__mark.full > 0, null, {timeout: 20000});
  const mark = await page.evaluate(() => window.__mark);
  const busy = await busySince(page, mark.key);
  // The focus may follow the first frame by one more.
  mark.focus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
  return {ready: Math.round(mark.ready), first: Math.round(mark.first), full: Math.round(mark.full), busy, focus: mark.focus};
}

async function main() {
  const dist = path.join(root, 'dist-e2e');
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('Build first: npm run build:e2e');
  const server = await startStaticServer(dist, 4174);
  const browser = await chromium.launch();
  const results = {cpu: CPU, chats: CHATS, launches: [], launchBusy: [], opens: [], backs: [], photoBacks: []};
  try {
    for (let launch = 0; launch < LAUNCHES; launch += 1) {
      const context = await browser.newContext({viewport: {width: 600, height: 600}, locale: 'en-US'});
      await context.addInitScript(NO_NATIVE_SPEECH);
      await context.addInitScript(PAGE_SCRIPT);
      await context.addInitScript(LUMEN_SCRIPT);
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', {rate: CPU});
      await page.goto(`${APP}/`);
      await page.waitForFunction(() => window.__launch != null, null, {timeout: 60000});
      results.launches.push(Math.round(await page.evaluate(() => window.__launch)));
      await page.waitForTimeout(8000);
      results.launchBusy.push(await page.evaluate(() => {
        const tasks = window.__longTasks.filter(([start]) => start < 8000);
        return [Math.round(tasks.reduce((sum, [, duration]) => sum + duration, 0)),
          Math.round(Math.max(0, ...tasks.map(([start, duration]) => start + duration)))];
      }));

      if (launch === LAUNCHES - 1) {
        results.rowsInDom = await page.evaluate(selector => document.querySelectorAll(selector).length, CHAT_ROW);
        // Down to the target chat, then open and close it RUNS times.
        for (let i = 0; i < 12 && !TARGET.test(await activeLabel(page)); i += 1) {
          await page.keyboard.press('ArrowDown');
          await page.waitForTimeout(400);
        }
        const label = await activeLabel(page);
        if (!TARGET.test(label)) throw new Error(`target chat not focused: ${label}`);
        results.target = label;
        const row = `[role="button"][aria-label="${label.replace(/"/g, '\\"')}"]`;
        for (let run = 0; run < RUNS; run += 1) {
          results.opens.push(await timeKey(page, 'Enter', '.thread-shell', row));
          await page.waitForTimeout(2500);
          const back = await timeKey(page, 'Escape', row, '.thread-shell');
          back.focusOk = back.focus === label;
          results.backs.push(back);
          await page.waitForTimeout(1500);
        }
        if (process.env.PERF_SHOTS) {
          fs.mkdirSync(process.env.PERF_SHOTS, {recursive: true});
          await page.screenshot({path: path.join(process.env.PERF_SHOTS, 'list-after-back.png')});
        }

        // A photo taken from the conversation, then Back from its send screen to the conversation.
        page.on('filechooser', chooser => chooser.setFiles(PHOTO));
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2500);
        for (let run = 0; run < RUNS; run += 1) {
          await page.evaluate(() => [...document.querySelectorAll('.thread-shell .action-dock [data-uit-interactable]')]
            .find(button => button.textContent?.trim() === 'Photo')?.focus());
          await page.keyboard.press('Enter');
          await page.waitForSelector('.photo-send-layer');
          await page.waitForTimeout(1500);
          const back = await timeKey(page, 'Escape', '.thread-shell', '.photo-send-layer');
          back.focusOk = back.focus === 'Photo' || /^Photo$/.test(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
          results.photoBacks.push(back);
          await page.waitForTimeout(1500);
        }
        if (process.env.PERF_SHOTS) {
          await page.screenshot({path: path.join(process.env.PERF_SHOTS, 'conversation-after-photo-back.png')});
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  const summary = {
    cpu: `${CPU}x`,
    chats: CHATS,
    rowsInDom: results.rowsInDom,
    target: results.target,
    launchMs: median(results.launches),
    launchBusyMs: median(results.launchBusy.map(([busy]) => busy)),
    launchIdleMs: median(results.launchBusy.map(([, idle]) => idle)),
    openReadyMs: median(results.opens.map(sample => sample.ready)),
    openFirstMs: median(results.opens.map(sample => sample.first)),
    openFullMs: median(results.opens.map(sample => sample.full)),
    openBusyMs: median(results.opens.map(sample => sample.busy)),
    backReadyMs: median(results.backs.map(sample => sample.ready)),
    backFirstMs: median(results.backs.map(sample => sample.first)),
    backFullMs: median(results.backs.map(sample => sample.full)),
    backBusyMs: median(results.backs.map(sample => sample.busy)),
    backFocusOk: results.backs.every(sample => sample.focusOk),
    photoBackFirstMs: median(results.photoBacks.map(sample => sample.first)),
    photoBackFullMs: median(results.photoBacks.map(sample => sample.full)),
    photoBackBusyMs: median(results.photoBacks.map(sample => sample.busy)),
    photoBackFocusOk: results.photoBacks.every(sample => sample.focusOk),
  };
  if (process.env.PERF_OUT) fs.writeFileSync(process.env.PERF_OUT, JSON.stringify({summary, ...results}, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

await main();
