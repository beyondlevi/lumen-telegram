// Keyboard-only end-to-end tests.
//
//   npm run package && npm run build:e2e && npm run test:e2e   (Chromium + Firefox)
//   E2E_BROWSERS=chromium npm run test:e2e
//   E2E_SKIP_SLOW=1 npm run test:e2e        (skips the 30 s retry-window test)
//   E2E_VIEWPORT=480x640 npm run test:e2e   (Rokid HUD size; default 600x600)
//   E2E_TRACE=1                             (prints the focus after each key of the capture script)
//   E2E_ONLY='voice notes'                  (runs only the tests whose name matches)
//
// Two builds are served like the Lumen host serves a package (static files,
// SPA fallback):
// - dist/ (release, 127.0.0.1:4173): demo mode, setup and invalid-config
//   screens, the lazy GramJS chunk, a real-account start with Telegram blocked;
// - dist-e2e/ (127.0.0.1:4174): the same app with the Telegram connection
//   replaced by tests/e2e/fakeTelegram.ts, driven through window.__fakeTelegram,
//   for the normal (non-demo) flows.
// The offline package test unzips dist/<name>.mrbd.zip and serves it on 5500
// with every other origin blocked.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {unzipSync} from 'fflate';
import {chromium, firefox} from 'playwright';
import {fakeAudioScript} from './fakeAudio.mjs';
import {fakeSpeechScript, NO_NATIVE_SPEECH} from './fakeSpeech.mjs';
import {LONG_THREAD, longMessageScenario} from './longMessages.mjs';
import {startStaticServer} from './static-server.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const outDir = path.join(root, '.e2e-output');
const APP = 'http://127.0.0.1:4173';
const FAKE_APP = 'http://127.0.0.1:4174';
const PACKAGE_APP = 'http://127.0.0.1:5500';
const browsers = (process.env.E2E_BROWSERS ?? 'chromium,firefox').split(',');
const results = [];
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

fs.mkdirSync(outDir, {recursive: true});

/** A StringSession in GramJS's layout (data center 2, a random key Telegram does not know): not a credential. */
const FAKE_SESSION = (() => {
  const address = Buffer.from('149.154.167.51');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(address.length);
  const port = Buffer.alloc(2);
  port.writeUInt16BE(443);
  return `1${Buffer.concat([Buffer.from([2]), length, address, port, crypto.randomBytes(256)]).toString('base64')}`;
})();
const ACCOUNT = {'telegram.apiId': '12345', 'telegram.apiHash': '0123456789abcdef0123456789abcdef', 'telegram.session': FAKE_SESSION};

// ---------------------------------------------------------------- helpers

async function activeLabel(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return '(body)';
    const name = element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '';
    return `${element.tagName.toLowerCase()}|${name}`;
  });
}

async function press(page, key, times = 1) {
  for (let i = 0; i < times; i += 1) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }
}

async function pressUntil(page, key, pattern, max = 8) {
  for (let i = 0; i < max; i += 1) {
    await press(page, key);
    if (pattern.test(await activeLabel(page))) return;
  }
  throw new Error(`focus never matched ${pattern}; last: ${await activeLabel(page)}`);
}

async function waitForFocus(page, pattern, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (pattern.test(await activeLabel(page))) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`focus never matched ${pattern}; last: ${await activeLabel(page)}`);
}

async function waitForText(page, text, timeout = 10000) {
  await page.getByText(text, {exact: false}).first().waitFor({state: 'visible', timeout});
}

async function rowLabels(page) {
  return page.$$eval('[role="button"][aria-label]', elements => elements.map(element => element.getAttribute('aria-label')));
}

/** Whether the bubble whose label matches is on screen, between the header and the action rail. */
async function bubbleOnScreen(page, pattern) {
  return page.evaluate(source => {
    const bubble = [...document.querySelectorAll('.message-stack [aria-label]')].filter(element => new RegExp(source).test(element.getAttribute('aria-label') ?? '')).pop();
    if (!bubble) return 'missing';
    const rect = bubble.getBoundingClientRect();
    const dock = document.querySelector('.action-dock')?.getBoundingClientRect();
    const bottom = dock ? dock.top : window.innerHeight;
    return rect.height > 0 && rect.top >= 0 && rect.bottom <= bottom + 1 ? 'visible' : `off screen (${Math.round(rect.top)}..${Math.round(rect.bottom)}, rail at ${Math.round(bottom)})`;
  }, pattern.source);
}

async function bubbleLabels(page) {
  return page.$$eval('.message-stack [aria-label]', elements => elements.map(element => element.getAttribute('aria-label')));
}

async function unreadRows(page) {
  return page.$$eval('[role="img"][aria-label$="Unread Status"]', elements => elements.map(element => element.getAttribute('aria-label')));
}

async function loadedImages(page) {
  return page.$$eval('img', images => images.filter(image => image.complete && image.naturalWidth > 0).map(image => image.src));
}

async function reactionLabels(page) {
  return page.$$eval('[aria-label^="React with"], [aria-label$="not allowed in this chat"]', elements => elements.map(element => element.getAttribute('aria-label')));
}

/** Simulates the platform dictation composer: `input` events, then `change`. */
async function dictate(page, text) {
  await page.evaluate(value => {
    const field = document.activeElement;
    if (!(field instanceof HTMLTextAreaElement)) throw new Error('reply field is not focused');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    let current = '';
    for (const word of value.split(' ')) {
      current = current ? `${current} ${word}` : word;
      setter.call(field, current);
      field.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: word}));
    }
    field.dispatchEvent(new Event('change', {bubbles: true}));
  }, text);
  await page.waitForTimeout(200);
}

/** True when the app left Escape unhandled (so the host can close the app). */
async function escapeReachesHost(page) {
  await page.evaluate(() => {
    window.__escapePrevented = null;
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape') window.__escapePrevented = event.defaultPrevented;
    }, {once: true});
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return page.evaluate(() => window.__escapePrevented === false);
}

async function test(name, fn) {
  // E2E_ONLY=<regex> runs only the matching tests (e.g. E2E_ONLY='voice notes').
  if (process.env.E2E_ONLY && !new RegExp(process.env.E2E_ONLY).test(name)) return;
  const started = Date.now();
  try {
    await fn();
    results.push({name, ok: true, ms: Date.now() - started});
    console.log(`ok   ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    results.push({name, ok: false, error: error.message});
    console.log(`FAIL ${name}\n     ${error.stack?.split('\n').slice(0, 8).join('\n     ')}`);
  }
}

/** window.lumen with the given values; window.__lumenSet(next) changes them like the companion. */
function lumenScript(values, {seed = null, fakeInit = null} = {}) {
  return `
    (() => {
      const seed = ${JSON.stringify(seed)};
      if (seed) for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
      const fakeInit = ${JSON.stringify(fakeInit)};
      if (fakeInit && !sessionStorage.getItem('fake-telegram-init')) sessionStorage.setItem('fake-telegram-init', JSON.stringify(fakeInit));
      let values = ${JSON.stringify(values)};
      const listeners = [];
      window.__lumenSet = next => { values = next; listeners.forEach(cb => cb({...values})); };
      window.lumen = {config: {
        get: async () => ({...values}),
        onChange: cb => { listeners.push(cb); return () => listeners.splice(listeners.indexOf(cb), 1); },
      }};
    })();`;
}

/** The demo voice note in the E2E build, used as the scripted microphone's recording. */
const VOICE_FILE = () => `/assets/${fs.readdirSync(path.join(root, 'dist-e2e/assets')).find(file => file.endsWith('.ogg'))}`;

async function newPage(browser, {locale = 'en-US', values = null, seed = null, fakeInit = null, block = null, audio = false, speech = false} = {}) {
  const [width, height] = (process.env.E2E_VIEWPORT ?? '600x600').split('x').map(Number);
  const context = await browser.newContext({viewport: {width, height}, locale});
  // Chromium has a recognizer of its own (Google's, online); the glasses have
  // Lumen's. Tests get none, or the scripted one with speech: true.
  await context.addInitScript(NO_NATIVE_SPEECH);
  if (speech) await context.addInitScript(fakeSpeechScript());
  if (values) await context.addInitScript(lumenScript(values, {seed, fakeInit}));
  // The Lumen host's microphone/dictation API, scripted (see fakeAudio.mjs).
  if (audio) await context.addInitScript(fakeAudioScript(VOICE_FILE()));
  // Records every WebSocket the page opens, even one that fails before connecting.
  await context.addInitScript(() => {
    const Native = window.WebSocket;
    window.__webSockets = [];
    window.WebSocket = new Proxy(Native, {
      construct(target, args) {
        window.__webSockets.push(String(args[0]));
        return Reflect.construct(target, args);
      },
    });
  });
  const page = await context.newPage();
  const blocked = [];
  if (block) {
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(block)) return route.continue();
      blocked.push(url);
      return route.abort();
    });
  }
  // WebSockets (Telegram's transport) are not plain requests: record any attempt.
  page.on('websocket', ws => blocked.push(ws.url()));
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource|ERR_|NetworkError|CORS|fonts\.g|WebSocket/i.test(message.text())) {
      problems.push(`console: ${message.text()}`);
    }
  });
  return {context, page, problems, blocked};
}

const fake = (page, fn, arg) => page.evaluate(fn, arg);

// ------------------------------------------------------------ demo mode

const SENTINEL = 'REAL-DATA-SENTINEL';
const realStorage = {
  'lumen-telegram.chat-cache.v1': JSON.stringify({
    account: 'tg-0000000000000000',
    savedAt: 1790000000000,
    chats: [{id: '42', name: `${SENTINEL} Person`, isGroup: false, unreadCount: 3, hasPhoto: false, timestamp: 4102444800000,
      lastMessage: {id: '1', chatId: '42', fromMe: false, senderName: `${SENTINEL} Person`, timestamp: 4102444800000, content: {kind: 'text', text: `${SENTINEL} message`}}}],
    threads: {},
  }),
  'lumen-telegram.read-marks': JSON.stringify({42: 1}),
};
const DEMO = {...ACCOUNT, demo: 'demo-captures'};
const MAYA = '7700101';
const HIKE = '-4000042';
const LIBRARY = '-1001000000042';

async function assertNoRealData(page) {
  const html = await page.content();
  assert.ok(!html.includes(SENTINEL), 'no cached real data on screen');
  for (const word of ['Ana Souza', 'Conversas', 'Ontem', 'Você']) {
    assert.ok(!html.includes(word), `"${word}" is not on screen`);
  }
}

/** Replays the capture script from ROTEIRO-CAPTURAS.md, key by key, with its waits. */
async function demoFlow(browser, label, appUrl = APP, {audioOutput = true} = {}) {
  // pt-PT device: demo mode must still be in English. A real account is also
  // configured: demo mode must not connect to it.
  const {context, page, problems, blocked} = await newPage(browser, {locale: 'pt-PT', values: DEMO, seed: realStorage, block: appUrl});
  const shots = [];
  const step = async (keys, wait, name, check) => {
    for (const key of keys) {
      await page.keyboard.press(key);
      await page.waitForTimeout(500);
      if (process.env.E2E_TRACE) console.log(`     ${key} -> ${await activeLabel(page)}`);
    }
    await page.waitForTimeout(wait);
    if (check) await check();
    await assertNoRealData(page);
    if (name) {
      await page.screenshot({path: path.join(outDir, `${label}-demo-${name}.png`)});
      shots.push(name);
    }
  };
  const toReply = ['ArrowDown', 'ArrowLeft'];
  try {
    await page.goto(`${appUrl}/`);
    // 1. Chat list
    await step([], 3000, '01-list', async () => {
      await waitForText(page, 'Chats');
      assert.deepEqual(
        (await rowLabels(page)).map(row => row.split(', ').slice(0, 2).join(', ')),
        [
          'Voice search, Say a name',
          'Maya Chen, Can you bring the projector?',
          'Hike Crew, Leo: Photo: Trail map',
          'Sam Rivera, Reacted ❤️ to “Sounds good',
          'Library News, Poll: Best reading spot?',
          'Bike Shop, Document: Invoice_0042.pdf',
          'Jordan Lee, Location: Central Station',
          '+12025550199, Hi! Is the desk still available?',
        ],
      );
      assert.deepEqual(await unreadRows(page), [
        'Maya Chen, Unread Status', 'Hike Crew, Unread Status', 'Library News, Unread Status', '+12025550199, Unread Status',
      ]);
      assert.match(await activeLabel(page), /^div\|Maya Chen, /);
      assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
      assert.ok((await loadedImages(page)).length >= 4, 'profile photos');
      assert.ok(await page.getByText('JL', {exact: true}).count() >= 1, 'Jordan keeps initials');
      const loaded = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
      assert.ok(!loaded.some(name => /gramClient/.test(name)), 'demo never loads GramJS');
    });
    // 2. End of the list
    await step(Array(6).fill('ArrowDown'), 500, '02-list-end', async () => {
      assert.match(await activeLabel(page), /^div\|\+12025550199, /);
    });
    // 3. Group, its stacked reactions and the reactions it accepts
    await step(Array(5).fill('ArrowUp').concat('Enter'), 2000, null);
    await step(toReply, 300, '03-group', async () => {
      assert.match(page.url(), new RegExp(encodeURIComponent(HIKE)));
      assert.equal(await activeLabel(page), 'div|Reply');
      for (const text of ['Hike Crew', 'Priya Nair', 'Leo Park', 'Photo: Trail map', 'Count me in.']) await waitForText(page, text);
    });
    await step(['ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp'], 500, '04-group-reactions', async () => {
      assert.match(await activeLabel(page), /Me! Leaving at 7\., .*reactions 👍 2, ❤️ 1$/);
      assert.ok(await page.getByText('👍❤️', {exact: true}).count() >= 1, 'stacked badge');
    });
    await step(['Enter'], 800, '05-group-menu', async () => {
      assert.equal(await activeLabel(page), 'div|React with 👍');
      assert.deepEqual(await reactionLabels(page), ['React with 👍', 'React with ❤️', 'React with 🤣', 'React with 😢'], 'group accepts 🤣 and 😢 in place of 😂 and 😭');
    });
    await step(['Escape'], 500, null);
    // 4. Back to the list, then the 1:1 conversation
    await step(['Escape'], 1500, null, async () => {
      assert.match(await activeLabel(page), /^div\|Hike Crew, /);
    });
    await step(['ArrowUp', 'Enter'], 2000, null);
    await step(toReply, 300, '06-thread', async () => {
      assert.match(page.url(), new RegExp(MAYA));
      await waitForText(page, 'Can you bring the projector?');
      assert.equal(await activeLabel(page), 'div|Reply');
    });
    // 5. Reply
    await step(['Enter'], 800, '07-reply-field', async () => {
      assert.equal(await activeLabel(page), 'textarea|Reply to Maya Chen');
    });
    await dictate(page, 'Sure, I will bring it.');
    await step([], 300, '08-reply-draft');
    await step(['ArrowRight'], 300, '09-send-focused', async () => {
      assert.equal(await activeLabel(page), 'div|Send');
    });
    await step(['Enter'], 800, '10-sent', async () => {
      await waitForText(page, 'Message sent', 2000);
      assert.equal(await page.locator('textarea').count(), 0);
    });
    await step([], 4000, '11-answer', async () => {
      await waitForText(page, 'Perfect, thanks! See you at 10.', 1000);
      assert.equal(await activeLabel(page), 'div|Reply');
    });
    // 6. Message menu and reaction: a badge on that bubble
    await step(['ArrowUp', 'Enter'], 800, '12-menu', async () => {
      assert.equal(await activeLabel(page), 'div|React with 👍');
      assert.deepEqual(await reactionLabels(page), ['React with 👍', 'React with ❤️', 'React with 🤣', 'React with 😭'], 'standard set: 🤣 stands in for 😂');
    });
    await step(['ArrowRight', 'Enter'], 600, '13-reacted', async () => {
      await waitForText(page, 'Reacted ❤️', 2000);
      assert.match(await activeLabel(page), /Perfect, thanks! See you at 10\., .*reactions ❤️ 1$/);
    });
    // 7. Quoted reply from the menu (Back closes the field without sending)
    await step(['Enter', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight'], 300, null, async () => {
      assert.equal(await activeLabel(page), 'div|Reply');
    });
    await step(['Enter'], 800, '14-quoted-reply', async () => {
      assert.equal(await activeLabel(page), 'textarea|Reply to Maya Chen');
      assert.ok((await page.content()).includes('Reply to “Perfect, thanks! See yo…”'), 'quote hint');
    });
    await step(['Escape'], 800, null, async () => {
      assert.equal(await page.locator('textarea').count(), 0);
      assert.equal(await activeLabel(page), 'div|Reply');
    });
    // 8. Record and send a voice note (simulated microphone in demo mode)
    await step(['ArrowRight'], 300, null, async () => {
      assert.equal(await activeLabel(page), 'div|Voice');
    });
    await step(['Enter'], 3000, '15-recording', async () => {
      assert.match(page.url(), /\/record$/);
      assert.equal(await activeLabel(page), 'div|Send');
      await waitForText(page, '0:02', 1000);
    });
    // The demo microphone takes 1 s to start and the audio 2 s to arrive after Send.
    await step(['Enter'], 300, null, async () => {
      await waitForText(page, 'Finishing…', 1000);
      assert.equal(await activeLabel(page), 'div|Send');
    });
    await step([], 2200, '16-voice-sent', async () => {
      await waitForText(page, 'Voice message sent', 2000);
      assert.doesNotMatch(page.url(), /\/record$/);
      assert.equal(await activeLabel(page), 'div|Voice');
      assert.ok((await bubbleLabels(page)).some(label => /You: Voice message, 0:0[234]/.test(label)), 'sent voice note');
    });
    // 9. Voice message menu: Listen, Pause, Transcribe
    await step(['ArrowLeft', ...Array(6).fill('ArrowUp')], 300, null, async () => {
      assert.match(await activeLabel(page), /Maya Chen: Voice message, 0:06/);
    });
    await step(['Enter'], 800, '17-audio-menu', async () => {
      assert.equal(await activeLabel(page), 'div|Listen');
      assert.ok(await page.getByText('Transcribe', {exact: true}).count() >= 1);
    });
    await step(['Enter'], 2000, audioOutput ? '18-audio-playing' : null, async () => {
      if (audioOutput) assert.match(await activeLabel(page), /Playing, 0:0[1-5] of 0:06/);
    });
    await step(['Enter'], 600, null, async () => {
      if (audioOutput) assert.equal(await activeLabel(page), 'div|Pause');
    });
    await step(['Enter'], 300, audioOutput ? '19-audio-paused' : null, async () => {
      if (audioOutput) assert.match(await activeLabel(page), /Paused, 0:0[1-5] of 0:06/);
    });
    await step(['Enter', 'ArrowRight'], 300, null, async () => {
      assert.equal(await activeLabel(page), 'div|Transcribe');
    });
    await step(['Enter'], 1500, '20-transcribing', async () => {
      assert.match(page.url(), /\/transcript\//);
      await waitForText(page, 'Transcribing', 1000);
      await waitForText(page, 'Morning! Quick update', 1000);
    });
    await step([], 4000, '21-transcript', async () => {
      await waitForText(page, 'Save me a seat, see you soon.', 1000);
      assert.equal(await page.getByText('Transcribing').count(), 0);
    });
    await step(['Escape'], 1500, '22-transcript-in-bubble', async () => {
      assert.match(await activeLabel(page), /Maya Chen: Voice message, 0:06/);
      await waitForText(page, "Morning! Quick update: I'm on my way", 1000);
    });
    // 9. Photo: View first; Back returns to the same bubble
    await step(['ArrowUp'], 300, null, async () => {
      assert.match(await activeLabel(page), /Photo: Sketch from Monday/);
    });
    await step(['Enter'], 800, '23-photo-menu', async () => {
      assert.equal(await activeLabel(page), 'div|View');
    });
    await step(['Enter'], 2000, '24-photo-view', async () => {
      assert.match(page.url(), /\/photo\//);
      assert.ok(await page.evaluate(() => document.querySelector('.photo-image')?.naturalWidth > 0), 'photo shown');
    });
    await step(['Escape'], 1500, null, async () => {
      assert.match(await activeLabel(page), /Photo: Sketch from Monday/);
    });
    // 10. Your message with Maya's 👍
    await step(['ArrowUp', 'ArrowUp'], 500, '25-reaction-badge', async () => {
      assert.match(await activeLabel(page), /Yes, 10:00 in Room 3\., .*reactions 👍 1$/);
    });
    // 11. Back to the list
    await step(['Escape'], 1500, '26-list-after', async () => {
      assert.match(await activeLabel(page), /^div\|Maya Chen, You: Voice message, /);
      assert.deepEqual(await unreadRows(page), ['Library News, Unread Status', '+12025550199, Unread Status']);
    });
    // 12. A channel without reactions: the menu says so
    await step(['ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter'], 2000, null, async () => {
      assert.match(page.url(), new RegExp(encodeURIComponent(LIBRARY)));
    });
    await step(toReply.concat('ArrowUp', 'Enter'), 600, '27-reactions-off', async () => {
      await waitForText(page, 'Reactions are off in this chat', 2000);
      const labels = await page.$$eval('[aria-label$="not allowed in this chat"]', e => e.map(x => x.getAttribute('aria-label')));
      assert.equal(labels.length, 4, 'all four reactions disabled');
    });
    await step(['Escape', 'Escape'], 1500, null, async () => {
      assert.match(await activeLabel(page), /^div\|Library News, /);
    });
    // 13. Voice search, above the first chat: demo mode hears "Maia" (one
    //     letter off) and lists Maya Chen first
    for (let tries = 0; tries < 8 && !/Voice search/.test(await activeLabel(page)); tries += 1) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(400);
    }
    await step(['Enter'], 1500, '28-voice-search-listening', async () => {
      assert.match(new URL(page.url()).pathname, /^\/search$/);
      assert.match(await page.evaluate(() => document.body.innerText), /Listening…[\s\S]*“Maia”/);
    });
    await step([], 2500, '29-voice-search-results', async () => {
      assert.match(await activeLabel(page), /^div\|Maya Chen/);
    });
    await step(['Escape'], 1500, null, async () => {
      assert.equal(new URL(page.url()).pathname, '/');
      assert.match(await activeLabel(page), /Voice search/);
    });
    assert.equal(await escapeReachesHost(page), true, 'Escape on the list is left to the platform');

    assert.deepEqual(blocked.filter(url => !FONTS.test(url)), [], 'no request outside the app origin');
    assert.deepEqual(await page.evaluate(() => window.__webSockets), [], 'no WebSocket in demo mode');
    assert.deepEqual(
      await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]))),
      Object.fromEntries(Object.keys(realStorage).sort().map(key => [key, realStorage[key]])),
      'storage is left exactly as it was',
    );
    assert.deepEqual(problems, []);
    return {shots, blocked};
  } finally {
    await context.close();
  }
}

// ------------------------------------------------------- normal mode (fake)

const ANA = '1001';
const FAMILY = '-2002';
const CARLA = '1003';

async function mainFlow(browser, label) {
  const {context, page, problems} = await newPage(browser, {values: ACCOUNT});
  try {
    await page.goto(`${FAKE_APP}/`);
    await waitForText(page, 'Chats');
    await waitForText(page, 'Carla Dias');
    await page.waitForTimeout(800);
    const rows = await rowLabels(page);
    assert.deepEqual(
      rows.map(row => row.split(', ').slice(0, 2).join(', ')),
      [
        'Ana Souza, Levo o projetor',
        '+15550100106, Sticker: 👋',
        'Família, Bruno: Photo: Olha isso',
        'Carla Dias, You: Voice message',
        'Avisos, Poll: Melhor horário?',
        'Diego Alves, Video',
      ],
      `rows: ${JSON.stringify(rows)}`,
    );
    assert.deepEqual(await unreadRows(page), ['Ana Souza, Unread Status', '+15550100106, Unread Status']);
    assert.match(await activeLabel(page), /^div\|Ana Souza, /);
    // Photos: Ana and Família load; Carla's is broken and keeps the initials.
    await page.waitForTimeout(800);
    const images = await loadedImages(page);
    assert.equal(images.length, 2, `two profile photos: ${images}`);
    assert.ok(await page.getByText('CD', {exact: true}).count() >= 1, 'Carla keeps her initials');
    await page.screenshot({path: path.join(outDir, `${label}-1-list.png`)});

    // Open: rail, voice note, badge, marked as read
    await press(page, 'Enter');
    await page.waitForURL(`**/chat/${ANA}`);
    for (const text of ['0:06', 'Combinado, até amanhã', 'Oi! Tudo certo para amanhã?', 'Reply']) await waitForText(page, text);
    await page.waitForTimeout(600);
    assert.equal(await page.locator('textarea').count(), 0, 'reply field only appears after Reply');
    assert.ok(
      await page.evaluate(() => [...document.querySelectorAll('[aria-disabled="true"], [disabled]')].some(element => /Voice/.test(element.textContent ?? '') || /Voice/.test(element.getAttribute('aria-label') ?? ''))),
      'Voice is disabled when the host has no window.lumen.audio',
    );
    assert.equal(await page.getByText(/tails/i).count(), 0, 'no Hide tails button');
    assert.ok((await bubbleLabels(page)).some(item => /Combinado, até amanhã, .*reactions 👍 1$/.test(item)), 'reaction badge');
    const reads = await fake(page, () => window.__fakeTelegram.log.reads);
    assert.equal(reads.at(-1)?.chatId, ANA, 'opening the chat marks it as read');
    await page.screenshot({path: path.join(outDir, `${label}-2-thread.png`)});

    // Reply → dictation → Send
    await press(page, 'ArrowDown');
    await press(page, 'ArrowLeft');
    assert.equal(await activeLabel(page), 'div|Reply');
    await press(page, 'Enter');
    assert.equal(await activeLabel(page), 'textarea|Reply to Ana Souza');
    await dictate(page, 'Pode deixar, obrigado');
    await press(page, 'ArrowRight');
    assert.match(await activeLabel(page), /Send/);
    await press(page, 'Enter');
    await waitForText(page, 'Message sent');
    await waitForText(page, 'Pode deixar, obrigado');
    let sent = await fake(page, () => window.__fakeTelegram.log.sent);
    assert.deepEqual(sent.at(-1), {chatId: ANA, text: 'Pode deixar, obrigado', replyToId: null});
    await page.waitForTimeout(500);
    assert.equal(await activeLabel(page), 'div|Reply', 'focus returns to Reply');

    // Bubble menu → Reply: Telegram reply_to with the message id
    await pressUntil(page, 'ArrowUp', /Oi! Tudo certo para amanhã\?/);
    await press(page, 'Enter');
    assert.equal(await activeLabel(page), 'div|React with 👍');
    await pressUntil(page, 'ArrowRight', /^div\|Reply$/);
    await press(page, 'Enter');
    await dictate(page, 'Sim, tudo certo');
    await press(page, 'ArrowRight');
    await press(page, 'Enter');
    await waitForText(page, 'Sim, tudo certo');
    sent = await fake(page, () => window.__fakeTelegram.log.sent);
    const quotedId = await fake(page, () => window.__fakeTelegram.chatFor('1001').messages.find(m => m.content.text === 'Oi! Tudo certo para amanhã?').id);
    assert.deepEqual(sent.at(-1), {chatId: ANA, text: 'Sim, tudo certo', replyToId: quotedId});

    // Reaction: badge at once, never a bubble; choosing it again removes it
    await pressUntil(page, 'ArrowUp', /Levo o projetor/);
    await press(page, 'Enter');
    await pressUntil(page, 'ArrowRight', /React with ❤️/);
    await press(page, 'Enter');
    await waitForText(page, 'Reacted ❤️');
    const reactions = await fake(page, () => window.__fakeTelegram.log.reactions);
    assert.equal(reactions.at(-1).emoji, '❤', 'Telegram gets ❤ without the variation selector');
    await page.waitForTimeout(300);
    assert.match(await activeLabel(page), /Levo o projetor, .*reactions ❤️ 1$/);
    await press(page, 'Enter');
    await pressUntil(page, 'ArrowRight', /React with ❤️/);
    await press(page, 'Enter');
    await waitForText(page, 'Reaction removed');
    await page.waitForTimeout(300);
    assert.doesNotMatch(await activeLabel(page), /reactions/);

    // Push update: a new message shows without waiting for the 10 s poll
    const pushedAt = Date.now();
    await fake(page, () => window.__fakeTelegram.incoming('1001', 'Chegando em 5 min', 'Ana Souza'));
    await waitForText(page, 'Chegando em 5 min', 4000);
    assert.ok(Date.now() - pushedAt < 4000, 'pushed update refreshes the thread');

    // Escape: the list, same chat focused
    await press(page, 'Escape');
    await page.waitForURL(`${FAKE_APP}/`);
    await page.waitForTimeout(600);
    assert.match(await activeLabel(page), /^div\|Ana Souza, Chegando em 5 min/);

    // Another chat gets a message while the list is open (push)
    await fake(page, () => window.__fakeTelegram.incoming('1003', 'Cheguei', 'Carla Dias'));
    await page.waitForFunction(() => document.querySelector('[role="button"][aria-label]')?.getAttribute('aria-label')?.startsWith('Carla Dias, Cheguei'), null, {timeout: 4000});
    assert.ok((await unreadRows(page)).includes('Carla Dias, Unread Status'));
    assert.ok(!(await unreadRows(page)).includes('Ana Souza, Unread Status'));

    // Replying to a chat further down moves it to the top; Back still lands on it
    await pressUntil(page, 'ArrowDown', /^div\|Diego Alves, /);
    await press(page, 'Enter');
    for (const text of ['Document: orcamento.pdf', 'Location: Praça Central', 'Contact: Rita Gomes', 'Video']) await waitForText(page, text);
    await page.waitForTimeout(600);
    // An audio file that is not a voice note shows as a playable audio bubble with Listen and Transcribe
    assert.ok((await bubbleLabels(page)).some(label => /Diego Alves: Audio, 0:06/.test(label)), `audio file bubble: ${JSON.stringify(await bubbleLabels(page))}`);
    assert.ok(!(await bubbleLabels(page)).some(label => /Diego Alves: Voice message/.test(label)), 'an audio file is not called a voice message');
    await page.evaluate(() => [...document.querySelectorAll('[aria-haspopup="menu"]')].find(element => /Diego Alves: Audio, 0:06/.test(element.getAttribute('aria-label') ?? ''))?.focus());
    await press(page, 'Enter');
    assert.equal(await activeLabel(page), 'div|Listen');
    assert.ok(await page.getByText('Transcribe', {exact: true}).count() >= 1, 'Transcribe in the audio file menu');
    await press(page, 'Escape');
    await page.waitForTimeout(400);
    await pressUntil(page, 'ArrowDown', /^div\|(Reply|Voice|Photos)$/);
    await pressUntil(page, 'ArrowLeft', /^div\|Reply$/);
    await press(page, 'Enter');
    await dictate(page, 'Recebi, obrigado');
    await press(page, 'ArrowRight');
    await press(page, 'Enter');
    await waitForText(page, 'Message sent');
    await page.waitForTimeout(400);
    await press(page, 'Escape');
    await page.waitForURL(`${FAKE_APP}/`);
    await page.waitForTimeout(800);
    assert.match(await activeLabel(page), /^div\|Diego Alves, /);

    assert.equal(await escapeReachesHost(page), true, 'Escape on the list is not consumed');
    assert.deepEqual(problems, []);
  } finally {
    await context.close();
  }
}

async function mediaFlow(browser, {audioOutput}) {
  const {context, page, problems} = await newPage(browser, {values: ACCOUNT});
  try {
    await page.goto(`${FAKE_APP}/chat/${FAMILY}`);
    await waitForText(page, 'Photo: Olha isso');
    await page.waitForTimeout(800);
    assert.ok((await loadedImages(page)).length >= 1, 'header photo');
    // Família accepts 👍 ❤ 🤣: 🤣 stands in for 😂 and 😭 is disabled.
    await press(page, 'ArrowDown');
    await press(page, 'ArrowLeft');
    await pressUntil(page, 'ArrowUp', /Photo: Olha isso/);
    await press(page, 'Enter');
    assert.equal(await activeLabel(page), 'div|View', 'View is the first menu item for a photo');
    assert.deepEqual(await reactionLabels(page), ['React with 👍', 'React with ❤️', 'React with 🤣', '😭 is not allowed in this chat']);
    await page.screenshot({path: path.join(outDir, 'media-1-photo-menu.png')});
    await press(page, 'Enter');
    await page.waitForURL(/\/photo\//);
    await page.waitForFunction(() => document.querySelector('.photo-image')?.naturalWidth > 0, null, {timeout: 8000});
    assert.equal((await fake(page, () => window.__fakeTelegram.log.mediaRequests)).length, 1, 'downloaded on open');
    await page.screenshot({path: path.join(outDir, 'media-2-photo.png')});
    await press(page, 'Escape');
    await waitForFocus(page, /Photo: Olha isso/);

    // Download failure: error copy and Try again
    await page.evaluate(() => sessionStorage.setItem('fake-telegram-init', JSON.stringify({mediaFails: true})));
    await page.reload();
    await waitForText(page, 'Photo: Olha isso');
    await page.waitForTimeout(800);
    await press(page, 'ArrowDown');
    await press(page, 'ArrowLeft');
    await pressUntil(page, 'ArrowUp', /Photo: Olha isso/);
    await press(page, 'Enter');
    await press(page, 'Enter');
    await waitForText(page, "Couldn't load the photo");
    await waitForText(page, 'not allowed in this chat');
    await page.screenshot({path: path.join(outDir, 'media-3-photo-error.png')});
    await pressUntil(page, 'ArrowDown', /Try again/);
    await press(page, 'Escape');
    await page.evaluate(() => sessionStorage.removeItem('fake-telegram-init'));

    // Avisos: reactions are off
    await page.goto(`${FAKE_APP}/chat/-1009`);
    await waitForText(page, 'Poll: Melhor horário?');
    await page.waitForTimeout(800);
    await press(page, 'ArrowDown');
    await press(page, 'ArrowLeft');
    await press(page, 'ArrowUp');
    await press(page, 'Enter');
    await waitForText(page, 'Reactions are off in this chat');
    await press(page, 'Escape');

    // Voice message: Enter plays and pauses
    await page.goto(`${FAKE_APP}/chat/${ANA}`);
    await waitForText(page, '0:06');
    await page.waitForTimeout(800);
    await press(page, 'ArrowDown');
    await press(page, 'ArrowLeft');
    await pressUntil(page, 'ArrowUp', /Voice message/, 10);
    await press(page, 'Enter');
    assert.equal(await activeLabel(page), 'div|Listen', 'the voice message menu starts with Listen');
    assert.equal((await page.$$('[aria-label="Transcribe (not available on this device)"]')).length, 1, 'Transcribe is off without the host API');
    await press(page, 'Enter');
    if (audioOutput) {
      await waitForFocus(page, /Playing, 0:0[1-5] of 0:06/, 6000);
      await page.screenshot({path: path.join(outDir, 'media-4-audio-playing.png')});
      await press(page, 'Enter');
      assert.equal(await activeLabel(page), 'div|Pause', 'Listen reads Pause while playing');
      await press(page, 'Enter');
      await waitForFocus(page, /Paused, /);
    }
    assert.ok((await fake(page, () => window.__fakeTelegram.log.mediaRequests)).some(item => item.chatId === ANA));
    assert.deepEqual(problems, []);
  } finally {
    await context.close();
  }
}

/** Voice notes through the scripted window.lumen.audio, against the scripted Telegram. */
async function voiceFlow(browser) {
  const {context, page, problems} = await newPage(browser, {values: ACCOUNT, audio: true});
  const audioLog = () => page.evaluate(() => window.__audioLog);
  const voiceSent = () => fake(page, () => window.__fakeTelegram.log.voice);
  const control = value => page.evaluate(next => Object.assign(window.__audioControl, next), value);
  const toVoice = async () => {
    await press(page, 'ArrowDown');
    await press(page, 'ArrowLeft');
    await press(page, 'ArrowRight');
    assert.equal(await activeLabel(page), 'div|Voice');
  };
  try {
    await page.goto(`${FAKE_APP}/`);
    await waitForText(page, 'Carla Dias');
    await press(page, 'Enter');
    await page.waitForURL(`**/chat/${ANA}`);
    await waitForText(page, 'Levo o projetor');
    await page.waitForTimeout(800);
    await toVoice();

    // Record and send: a native voice note with its length and waveform
    await press(page, 'Enter');
    await page.waitForURL(/\/record$/);
    await waitForText(page, 'Recording');
    assert.equal(await activeLabel(page), 'div|Send', 'Send has the initial focus');
    await waitForText(page, '0:01', 3000);
    await page.screenshot({path: path.join(outDir, 'voice-1-recording.png')});
    await press(page, 'Enter');
    await waitForText(page, 'Voice message sent', 5000);
    await page.waitForURL(`**/chat/${ANA}`);
    let sent = await voiceSent();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].head, 'OggS');
    assert.ok(sent[0].seconds >= 1);
    assert.equal(sent[0].waveform.length, 100, '100-sample waveform');
    assert.ok(Math.max(...sent[0].waveform) === 31 && sent[0].waveform.some(value => value < 31), `waveform from the levels: ${sent[0].waveform.slice(0, 10)}`);
    assert.equal((await audioLog()).stops, 1);
    await page.waitForTimeout(500);
    assert.ok((await bubbleLabels(page)).some(label => /You: Voice message, 0:0\d/.test(label)), 'the sent voice note shows');
    {
      const label = await activeLabel(page);
      assert.equal(label, 'div|Voice', `focus returns to Voice, got ${label}`);
    }
    // The sent note is on screen above the rail (0.2.0 left it under the rail, out of view and
    // skipped by Up), reachable with Up, previewed as yours, and shown again when the chat reopens.
    assert.equal(await bubbleOnScreen(page, /You: Voice message/), 'visible', 'the sent voice note is in view after sending');
    await page.screenshot({path: path.join(outDir, 'voice-7-sent-in-view.png')});
    await press(page, 'ArrowUp');
    assert.match(await activeLabel(page), /^div\|Actions for message: You: Voice message, 0:0\d/, 'Up from Voice reaches the sent voice note');
    await press(page, 'Escape');
    await page.waitForURL(`${FAKE_APP}/`);
    await page.waitForTimeout(800);
    assert.match(await activeLabel(page), /^div\|Ana Souza, You: Voice message, /, 'the list previews the note as yours');
    await press(page, 'Enter');
    await page.waitForURL(`**/chat/${ANA}`);
    await page.waitForTimeout(1500);
    assert.equal(await bubbleOnScreen(page, /You: Voice message/), 'visible', 'the voice note is in view when the chat reopens');
    assert.match(await activeLabel(page), /^div\|Actions for message: You: Voice message/, 'reopening focuses the newest message');
    await page.screenshot({path: path.join(outDir, 'voice-8-reopened.png')});
    await pressUntil(page, 'ArrowDown', /^div\|(Reply|Voice|Photos)$/);
    if (await activeLabel(page) !== 'div|Voice') await pressUntil(page, 'ArrowLeft', /^div\|Voice$/);

    // Discard, then Back: nothing sent, recordings cancelled
    await press(page, 'Enter');
    await page.waitForURL(/\/record$/);
    await page.waitForTimeout(600);
    await press(page, 'ArrowRight');
    assert.equal(await activeLabel(page), 'div|Discard');
    await press(page, 'Enter');
    await page.waitForURL(`**/chat/${ANA}`);
    await page.waitForTimeout(500);
    await press(page, 'Enter');
    await page.waitForURL(/\/record$/);
    await page.waitForTimeout(600);
    await press(page, 'Escape');
    await page.waitForURL(`**/chat/${ANA}`);
    await page.waitForTimeout(500);
    assert.equal((await audioLog()).cancels, 2, 'Discard and Back cancel the recording');
    assert.equal((await voiceSent()).length, 1, 'nothing more was sent');

    // The 2-minute limit
    await control({endAfterMs: 1200});
    await press(page, 'Enter');
    await page.waitForURL(/\/record$/);
    await waitForText(page, 'Reached the 2:00 limit', 4000);
    assert.equal(await activeLabel(page), 'div|Send');
    assert.equal((await audioLog()).records.at(-1).maxMs, 120000, 'records with the 2-minute limit');
    await page.screenshot({path: path.join(outDir, 'voice-2-limit.png')});
    await press(page, 'Enter');
    await waitForText(page, 'Voice message sent', 5000);
    assert.equal((await voiceSent()).length, 2);
    await control({endAfterMs: null});
    await page.waitForTimeout(500);

    // A host as slow as the glasses: "Starting…" until record() resolves, then
    // "Finishing…" until stop() resolves; Send is disabled in both and keeps the focus.
    const sendDisabled = () =>
      page.evaluate(() => [...document.querySelectorAll('[aria-disabled="true"], [disabled]')].some(element => /^Send$/.test((element.textContent ?? '').trim()) || element.getAttribute('aria-label') === 'Send'));
    // The thread behind may show "0:01" too: read the time in the recording panel only.
    const panelShows = text => page.locator('.record-panel').getByText(text, {exact: true}).waitFor({timeout: 4000});
    await control({startDelayMs: 1500, stopDelayMs: 2000});
    await press(page, 'Enter');
    await page.waitForURL(/\/record$/);
    await waitForText(page, 'Starting…', 1000);
    assert.equal(await activeLabel(page), 'div|Send', 'Send has the focus while the microphone starts');
    await page.waitForTimeout(600); // let the route transition finish (the microphone takes 1.5 s here)
    await page.getByText('Starting…').first().waitFor({timeout: 500});
    await page.screenshot({path: path.join(outDir, 'voice-5-starting.png')});
    const stopsBefore = (await audioLog()).stops;
    await press(page, 'Enter');
    await page.waitForTimeout(200);
    assert.equal((await audioLog()).stops, stopsBefore, 'Send does nothing until the microphone has started');
    await panelShows('0:01');
    assert.equal(await sendDisabled(), false, 'Send is enabled while recording');
    assert.equal(await activeLabel(page), 'div|Send');
    await press(page, 'Enter');
    await waitForText(page, 'Finishing…', 1000);
    assert.equal(await sendDisabled(), true, 'Send is disabled while the audio arrives');
    assert.equal(await activeLabel(page), 'div|Send', 'Send keeps the focus while finishing');
    await page.screenshot({path: path.join(outDir, 'voice-6-finishing.png')});
    await press(page, 'Enter');
    await waitForText(page, 'Voice message sent', 5000);
    assert.equal((await audioLog()).stops, stopsBefore + 1, 'Enter while finishing does nothing');
    assert.equal((await voiceSent()).length, 3);
    await page.waitForURL(`**/chat/${ANA}`);
    await page.waitForTimeout(500);
    // Back while finishing drops the recording: nothing is sent when stop() resolves
    await press(page, 'Enter');
    await page.waitForURL(/\/record$/);
    await panelShows('0:01');
    await press(page, 'Enter');
    await waitForText(page, 'Finishing…', 1000);
    await press(page, 'Escape');
    await page.waitForURL(`**/chat/${ANA}`);
    await page.waitForTimeout(2500);
    assert.equal((await voiceSent()).length, 3, 'Back while finishing sends nothing');
    await control({startDelayMs: 0, stopDelayMs: 0});
    await page.waitForTimeout(500);

    // Host errors: busy (then Try again works), no-phone
    await control({recordError: 'busy'});
    await press(page, 'Enter');
    await waitForText(page, "Couldn't record");
    await waitForText(page, 'busy with another recording or dictation');
    assert.equal(await activeLabel(page), 'div|Try again');
    await page.screenshot({path: path.join(outDir, 'voice-3-busy.png')});
    await press(page, 'Enter');
    await waitForText(page, '0:01', 3000);
    await press(page, 'Escape');
    await page.waitForURL(`**/chat/${ANA}`);
    await page.waitForTimeout(500);
    await control({recordError: 'no-phone'});
    await press(page, 'Enter');
    await waitForText(page, 'not connected to the phone');
    await press(page, 'Escape');
    await page.waitForURL(`**/chat/${ANA}`);
    await page.waitForTimeout(500);

    // Transcribe Ana's voice note: partials, then the text; kept for the session
    await press(page, 'ArrowLeft');
    await pressUntil(page, 'ArrowUp', /Ana Souza: Voice message/, 12);
    await press(page, 'Enter');
    assert.equal(await activeLabel(page), 'div|Listen');
    await press(page, 'ArrowRight');
    assert.equal(await activeLabel(page), 'div|Transcribe');
    await press(page, 'Enter');
    await page.waitForURL(/\/transcript\//);
    await waitForText(page, 'Transcribing');
    await page.waitForFunction(() => window.__audioLog.partials >= 2, null, {timeout: 3000});
    await waitForText(page, 'This is a fake transcript of the voice message.', 5000);
    await page.screenshot({path: path.join(outDir, 'voice-4-transcript.png')});
    await press(page, 'Escape');
    await waitForFocus(page, /Ana Souza: Voice message/);
    await waitForText(page, 'This is a fake transcript');
    await press(page, 'Enter');
    await press(page, 'ArrowRight');
    await press(page, 'Enter');
    await waitForText(page, 'This is a fake transcript of the voice message.', 1000);
    assert.equal((await audioLog()).transcribes, 1, 'the second opening uses the kept transcript');
    await press(page, 'Escape');
    await waitForFocus(page, /Ana Souza: Voice message/);

    // Engine error, then Try again (on the voice note just sent: its audio is in memory)
    await control({transcribeError: 'engine', transcript: 'Second try worked.'});
    await pressUntil(page, 'ArrowDown', /You: Voice message/, 12);
    await press(page, 'Enter');
    await press(page, 'ArrowRight');
    await press(page, 'Enter');
    await waitForText(page, "Couldn't transcribe");
    await waitForText(page, 'The transcription engine failed: Model not downloaded');
    await pressUntil(page, 'ArrowDown', /Try again/);
    await press(page, 'Enter');
    await waitForText(page, 'Second try worked.', 5000);
    await press(page, 'Escape');
    assert.deepEqual(problems, []);
  } finally {
    await context.close();
  }
}

// ------------------------------------------------------------------ run

const DIEGO = '1005';

/** A conversation whose first, middle and last messages are taller than the screen. */
async function longMessagesFlow(browser, label) {
  const {context, page, problems} = await newPage(browser, {values: ACCOUNT});
  try {
    await page.goto(`${FAKE_APP}/`);
    await waitForText(page, 'Diego Alves');
    await page.waitForTimeout(800);
    // Diego's conversation becomes exactly the five test messages.
    await fake(page, ({chatId, texts}) => {
      window.__fakeTelegram.chatFor(chatId).messages.splice(0);
      for (const text of texts) window.__fakeTelegram.incoming(chatId, text, 'Diego Alves');
    }, {chatId: DIEGO, texts: LONG_THREAD});
    await waitForText(page, 'LAST line 1');
    await page.waitForTimeout(800);
    for (let tries = 0; tries < 8 && !/^div\|Diego Alves, /.test(await activeLabel(page)); tries += 1) await press(page, 'ArrowUp');
    for (let tries = 0; tries < 8 && !/^div\|Diego Alves, /.test(await activeLabel(page)); tries += 1) await press(page, 'ArrowDown');
    await press(page, 'Enter');
    await page.waitForURL(`**/chat/${DIEGO}`);
    await waitForText(page, 'short two');
    await page.waitForTimeout(1200);
    await press(page, 'ArrowDown');
    await press(page, 'ArrowLeft');
    await page.waitForTimeout(600);
    const steps = await longMessageScenario(page, {
      screenshot: name => page.screenshot({path: path.join(outDir, `${label}-${name}.png`)}),
      deliver: text => fake(page, ({chatId, value}) => window.__fakeTelegram.incoming(chatId, value, 'Diego Alves'), {chatId: DIEGO, value: text}),
    });
    console.log(`     scroll steps inside each long message: ${JSON.stringify(steps)}`);
    assert.deepEqual(problems, []);
  } finally {
    await context.close();
  }
}

const BRUNO = '1008';

/** Says `plan` (see fakeSpeech.mjs) on the next recognition. */
const willHear = (page, plan) => page.evaluate(next => (window.__speechControl.next = next), plan);

async function searchState(page) {
  return page.evaluate(() => document.body.innerText);
}

/** From the list's first chat: Up to Voice search, Enter. */
async function openVoiceSearch(page) {
  await waitForFocus(page, /^div\|Ana Souza, /);
  await press(page, 'ArrowUp');
  assert.match(await activeLabel(page), /Voice search/, 'one Up from the first chat reaches Voice search');
  await press(page, 'Enter');
  await page.waitForURL('**/search');
}

/** The result rows (titles and subtitles) of the voice search. */
async function resultRows(page) {
  return page.$$eval('[role="button"][aria-label]', elements => elements.map(element => element.getAttribute('aria-label')));
}

/** Voice search with SpeechRecognition, window.lumen.audio, fallbacks and errors (GramJS contacts through the fake). */
async function voiceSearchFlow(browser, label) {

  // No recognizer: no entry point.
  {
    const {context, page, problems} = await newPage(browser, {values: ACCOUNT});
    try {
      await page.goto(`${FAKE_APP}/`);
      await waitForText(page, 'Carla Dias');
      await page.waitForTimeout(600);
      assert.equal(await page.getByText('Voice search').count(), 0, 'hidden without speech recognition');
      await press(page, 'ArrowUp');
      assert.match(await activeLabel(page), /^div\|Ana Souza, /, 'Up from the first chat goes nowhere');
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  }

  // SpeechRecognition (Lumen's shim): partial text, a pause ends it, best match first.
  const {context, page, problems} = await newPage(browser, {values: ACCOUNT, speech: true});
  try {
    await page.goto(`${FAKE_APP}/`);
    await waitForText(page, 'Carla Dias');
    await page.waitForTimeout(800);
    assert.ok(await page.getByText('Voice search').count() >= 1, 'entry point shown');
    await page.screenshot({path: path.join(outDir, `${label}-search-1-list.png`)});
    await willHear(page, {text: 'Carla Diaz'});
    await openVoiceSearch(page);
    await waitForText(page, 'Listening…');
    await waitForText(page, '“Carla”', 3000);
    await page.waitForTimeout(200);
    await page.screenshot({path: path.join(outDir, `${label}-search-2-listening.png`)});
    await waitForFocus(page, /^div\|Carla Dias/, 6000);
    const log = await page.evaluate(() => window.__speechLog);
    assert.equal(log[0].op, 'start');
    assert.equal(log[0].lang, 'en-US', 'the page language');
    assert.equal(log[0].interimResults, true);
    assert.match(await searchState(page), /“Carla Diaz”/, 'what was heard is shown');
    await page.waitForTimeout(1500);
    await page.screenshot({path: path.join(outDir, `${label}-search-3-results.png`)});
    await press(page, 'Enter');
    await page.waitForURL(`**/chat/${CARLA}`);
    await waitForText(page, 'Me manda o endereço?');
    await press(page, 'Escape');
    await page.waitForURL(url => new URL(url).pathname === '/');
    await waitForText(page, 'Chats');

    // A contact without a chat (Bruno is only in the contacts): opens an empty conversation.
    await page.waitForTimeout(800);
    await willHear(page, {text: 'bruno lima'});
    await pressUntil(page, 'ArrowUp', /Voice search/);
    await press(page, 'Enter');
    await waitForFocus(page, /^div\|Bruno Lima, Contact/, 6000);
    await press(page, 'Enter');
    await page.waitForURL(`**/chat/${BRUNO}`);
    await page.waitForTimeout(1500);
    await waitForText(page, 'Reply');
    const contactScreen = await page.evaluate(() => document.body.innerText);
    assert.match(contactScreen, /Bruno Lima[\s\S]*No recent messages/, `the contact's name over an empty conversation: ${contactScreen}`);
    await page.screenshot({path: path.join(outDir, `${label}-search-4-contact.png`)});
    // The first reply starts the chat, which then joins the list.
    assert.match(await activeLabel(page), /Reply/);
    await press(page, 'Enter');
    await dictate(page, 'Oi Bruno');
    await press(page, 'ArrowRight');
    await press(page, 'Enter');
    await waitForText(page, 'Message sent');
    await page.waitForTimeout(800);
    await press(page, 'Escape');
    await page.waitForURL(url => new URL(url).pathname === '/');
    await page.getByText('Bruno Lima').first().waitFor({state: 'visible', timeout: 12000});

    // No accents, several results: Família first; Back returns to the list.
    await page.waitForTimeout(800);
    await willHear(page, {text: 'familia'});
    await pressUntil(page, 'ArrowUp', /Voice search/);
    await press(page, 'Enter');
    await waitForFocus(page, /^div\|Família/, 6000);
    await press(page, 'Escape');
    await page.waitForURL(url => new URL(url).pathname === '/');

    // No match, then Try again; Done ends the listening.
    await page.waitForTimeout(800);
    await willHear(page, {text: 'Zacarias'});
    await pressUntil(page, 'ArrowUp', /Voice search/);
    await press(page, 'Enter');
    await waitForText(page, 'No chat or contact matches “Zacarias”', 6000);
    await waitForFocus(page, /Try again/);
    await page.screenshot({path: path.join(outDir, `${label}-search-5-no-match.png`)});
    await willHear(page, {text: 'Diego', waitForStop: true});
    await press(page, 'Enter');
    await waitForText(page, '“Diego”', 3000);
    await page.waitForTimeout(1200);
    assert.match(await searchState(page), /Listening…/, 'keeps listening until Done');
    assert.match(await activeLabel(page), /Done/);
    await press(page, 'Enter');
    await waitForFocus(page, /^div\|Diego Alves/, 6000);
    assert.ok((await page.evaluate(() => window.__speechLog)).some(entry => entry.op === 'stop'), 'Done stops the recognizer');
    // Search again from the results.
    await willHear(page, {error: 'no-speech'});
    await pressUntil(page, 'ArrowDown', /Search again/);
    await press(page, 'Enter');
    await waitForText(page, "Didn't catch a name", 6000);
    await waitForFocus(page, /Try again/);
    // Back while listening cancels the recognizer.
    await willHear(page, {text: 'Ana', waitForStop: true});
    await press(page, 'Enter');
    await waitForText(page, '“Ana”', 3000);
    await press(page, 'Escape');
    await page.waitForURL(url => new URL(url).pathname === '/');
    // The search screen leaves (and stops listening) at the end of the route transition.
    for (let waited = 0; (await page.evaluate(() => window.__speechLog)).at(-1).op !== 'abort' && waited < 3000; waited += 100) {
      await page.waitForTimeout(100);
    }
    assert.equal((await page.evaluate(() => window.__speechLog)).at(-1).op, 'abort', 'Back aborts the recognition');
    assert.equal(await page.evaluate(() => window.__speechControl.active), null);

    // A recognizer that cannot work here (no microphone): said once, then the entry point goes away.
    await page.waitForTimeout(800);
    await willHear(page, {error: 'not-allowed'});
    await pressUntil(page, 'ArrowUp', /Voice search/);
    await press(page, 'Enter');
    await waitForText(page, "Voice search isn't available", 6000);
    await waitForFocus(page, /Back/);
    await press(page, 'Enter');
    await page.waitForURL(url => new URL(url).pathname === '/');
    await page.waitForTimeout(800);
    assert.equal(await page.getByText('Voice search').count(), 0, 'entry point hidden once speech failed as unavailable');
    assert.deepEqual(problems, []);
  } finally {
    await context.close();
  }

  // window.lumen.audio only (no SpeechRecognition): record, a pause ends it, transcribe.
  {
    const {context, page, problems} = await newPage(browser, {values: ACCOUNT, audio: true});
    try {
      await page.goto(`${FAKE_APP}/`);
      await waitForText(page, 'Carla Dias');
      await page.waitForTimeout(800);
      await page.evaluate(() => Object.assign(window.__audioControl, {quietAfterMs: 1000, transcript: 'Joao Silva'}));
      await openVoiceSearch(page);
      await waitForText(page, 'Listening…');
      await waitForText(page, 'No chat or contact matches “Joao Silva”', 8000);
      const audioLog = await page.evaluate(() => window.__audioLog);
      assert.equal(audioLog.records.length, 1);
      assert.equal(audioLog.stops, 1, 'the pause stopped the recording');
      assert.equal(audioLog.transcribes, 1);
      assert.ok(audioLog.partials >= 1, 'partial text while transcribing');
      await page.evaluate(() => Object.assign(window.__audioControl, {quietAfterMs: 800, transcript: 'ana souza'}));
      await press(page, 'Enter');
      await waitForFocus(page, /^div\|Ana Souza/, 8000);
      await press(page, 'Enter');
      await page.waitForURL(`**/chat/${ANA}`);
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  }

  // Both: SpeechRecognition refused (no microphone) falls back to window.lumen.audio.
  {
    const {context, page, problems} = await newPage(browser, {values: ACCOUNT, audio: true, speech: true, locale: 'pt-PT'});
    try {
      await page.goto(`${FAKE_APP}/`);
      await waitForText(page, 'Carla Dias');
      await page.waitForTimeout(800);
      assert.ok(await page.getByText('Busca por voz').count() >= 1, 'pt entry point');
      await willHear(page, {error: 'service-not-allowed'});
      await page.evaluate(() => Object.assign(window.__audioControl, {quietAfterMs: 800, transcript: 'Carla'}));
      await waitForFocus(page, /^div\|Ana Souza, /);
      await press(page, 'ArrowUp');
      await press(page, 'Enter');
      await waitForFocus(page, /^div\|Carla Dias/, 10000);
      const log = await page.evaluate(() => window.__speechLog);
      assert.equal(log[0].lang, 'pt-PT', 'the page language (pt-PT on the glasses)');
      assert.equal((await page.evaluate(() => window.__audioLog)).records.length, 1, 'fell back to window.lumen.audio');
      await page.screenshot({path: path.join(outDir, `${label}-search-6-pt-fallback.png`)});
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  }
}

async function run() {
  const releaseServer = await startStaticServer(path.join(root, 'dist'), 4173);
  const fakeServer = await startStaticServer(path.join(root, 'dist-e2e'), 4174);
  const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-telegram-package-'));
  const zipPath = path.join(root, 'dist', 'lumen-telegram.mrbd.zip');
  for (const [name, data] of Object.entries(unzipSync(fs.readFileSync(zipPath)))) {
    const target = path.join(packageDir, name);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, data);
  }
  const packageServer = await startStaticServer(packageDir, 5500);

  try {
    for (const name of browsers) {
      const browser = await (name === 'firefox' ? firefox : chromium).launch();
      try {
        await test(`[${name}] list, thread, reply, reply_to, reactions (badge, toggle), push updates, Back`, () => mainFlow(browser, name));
        await test(`[${name}] demo mode: capture script, fictional chats only, no requests, storage untouched`, async () => {
          // The sandbox has no audio output for Firefox; it decodes but cannot play.
          await demoFlow(browser, name, APP, {audioOutput: name !== 'firefox'});
        });
        await test(`[${name}] voice search: entry point, SpeechRecognition and window.lumen.audio, fuzzy names, contacts, no match, fallback`, () => voiceSearchFlow(browser, name));
        await test(`[${name}] long messages (first, middle, last): Down/Up scroll through each before moving on`, () => longMessagesFlow(browser, name));
        await test(`[${name}] voice notes: record, send (waveform), discard, Back, 2-minute limit, busy/no-phone, transcribe (partials, kept, engine error)`, () => voiceFlow(browser));
        await test(`[${name}] setup screen without configuration`, async () => {
          const {context, page, problems} = await newPage(browser);
          try {
            await page.goto(`${APP}/`);
            await waitForText(page, 'Connect Telegram');
            await waitForText(page, 'API ID, API hash, and Session');
            await page.screenshot({path: path.join(outDir, `${name}-setup.png`)});
            await press(page, 'ArrowDown', 2);
            assert.match(await activeLabel(page), /Check again/);
            await press(page, 'Enter');
            await waitForText(page, 'Still not configured');
            assert.equal(await escapeReachesHost(page), true);
            assert.deepEqual(problems, []);
          } finally {
            await context.close();
          }
        });
        await test(`[${name}] pt locale (pt-PT glasses)`, async () => {
          const {context, page} = await newPage(browser, {locale: 'pt-PT', values: ACCOUNT});
          try {
            await page.goto(`${FAKE_APP}/`);
            await waitForText(page, 'Conversas');
            await waitForText(page, 'Bruno: Foto: Olha isso');
            await waitForText(page, 'Você: Mensagem de voz');
            await waitForText(page, 'Figurinha: 👋');
            await page.screenshot({path: path.join(outDir, `${name}-pt-list.png`)});
          } finally {
            await context.close();
          }
        });
      } finally {
        await browser.close();
      }
    }

    const browser = await chromium.launch();
    try {
      await test('[chromium] photo View/Back/failure, allowed reactions, reactions off, voice playback', () => mediaFlow(browser, {audioOutput: true}));

      await test('[firefox] OGG/Opus voice note decodes (no audio output in this sandbox)', async () => {
        const gecko = await firefox.launch();
        try {
          const page = await gecko.newPage();
          await page.goto(`${APP}/`);
          const voice = fs.readdirSync(path.join(root, 'dist/assets')).find(file => file.endsWith('.ogg'));
          const meta = await page.evaluate(async url => {
            const blob = new Blob([await (await fetch(url)).arrayBuffer()], {type: 'audio/ogg'});
            const audio = new Audio(URL.createObjectURL(blob));
            await new Promise((resolve, reject) => {
              audio.addEventListener('loadedmetadata', resolve);
              audio.addEventListener('error', () => reject(new Error(`media error ${audio.error?.code}`)));
            });
            return {duration: audio.duration, canPlay: audio.canPlayType('audio/ogg; codecs=opus')};
          }, `/assets/${voice}`);
          assert.equal(meta.canPlay, 'probably');
          assert.ok(Math.abs(meta.duration - 6) < 0.1, `duration ${meta.duration}`);
        } finally {
          await gecko.close();
        }
      });

      await test('[chromium] invalid configuration screens', async () => {
        for (const [values, texts] of [
          [{...ACCOUNT, 'telegram.apiId': 'abc'}, ['Invalid API ID', 'my.telegram.org']],
          [{...ACCOUNT, 'telegram.apiHash': 'xyz'}, ['Invalid API hash']],
          [{...ACCOUNT, 'telegram.session': 'not-a-session'}, ['Invalid Session', 'npm run login']],
        ]) {
          const {context, page} = await newPage(browser, {values});
          try {
            await page.goto(`${APP}/`);
            for (const text of texts) await waitForText(page, text);
          } finally {
            await context.close();
          }
        }
      });

      await test('[chromium] session refused: "Session not accepted" at once (no 30 s wait)', async () => {
        const {context, page} = await newPage(browser, {values: {...ACCOUNT, 'telegram.apiId': '401'}});
        try {
          const started = Date.now();
          await page.goto(`${FAKE_APP}/`);
          await waitForText(page, 'Session not accepted', 5000);
          await waitForText(page, 'AUTH_KEY_UNREGISTERED');
          assert.ok(Date.now() - started < 5000);
          await page.screenshot({path: path.join(outDir, 'error-auth.png')});
          await press(page, 'ArrowDown', 2);
          assert.match(await activeLabel(page), /Try again/);
        } finally {
          await context.close();
        }
      });

      await test('[chromium] too many requests (FLOOD_WAIT)', async () => {
        const {context, page} = await newPage(browser, {values: ACCOUNT, fakeInit: {connect: 'flood'}});
        try {
          await page.goto(`${FAKE_APP}/`);
          await waitForText(page, 'Too many requests');
          await waitForText(page, 'wait 42 s');
        } finally {
          await context.close();
        }
      });

      await test('[chromium] header spinner while the internet comes up, then the list', async () => {
        const {context, page} = await newPage(browser, {values: ACCOUNT, fakeInit: {downForMs: 7000}});
        try {
          const started = Date.now();
          await page.goto(`${FAKE_APP}/`);
          await waitForText(page, 'Loading…', 3000);
          await page.screenshot({path: path.join(outDir, 'connecting.png')});
          await waitForText(page, 'Ana Souza', 15000);
          assert.ok(Date.now() - started >= 6000, 'list appears only after the connection is up');
        } finally {
          await context.close();
        }
      });

      await test('[chromium] cached chats show at once on the next launch; no credential in storage', async () => {
        const {context, page} = await newPage(browser, {values: ACCOUNT});
        try {
          await page.goto(`${FAKE_APP}/`);
          await waitForText(page, 'Carla Dias');
          await page.waitForTimeout(1200);
          await page.evaluate(() => sessionStorage.setItem('fake-telegram-init', JSON.stringify({downForMs: 6000})));
          const started = Date.now();
          await page.reload();
          await waitForText(page, 'Ana Souza', 1500);
          assert.ok(Date.now() - started < 1500, 'list comes from the cache');
          await waitForText(page, 'Loading…', 1000);
          await page.screenshot({path: path.join(outDir, 'cached-launch.png')});
          await waitForText(page, 'Chats', 15000);
          const storage = await page.evaluate(() => JSON.stringify({...localStorage}) + JSON.stringify({...sessionStorage}));
          assert.ok(!storage.includes(ACCOUNT['telegram.session'].slice(0, 40)), 'the session is not stored');
          assert.ok(!storage.includes(ACCOUNT['telegram.apiHash']), 'the API hash is not stored');
        } finally {
          await context.close();
        }
      });

      await test('[chromium] polling covers missing push updates', async () => {
        const {context, page} = await newPage(browser, {values: ACCOUNT});
        try {
          await page.goto(`${FAKE_APP}/chat/${CARLA}`);
          await waitForText(page, 'Me manda o endereço?');
          await page.waitForTimeout(500);
          await fake(page, () => {
            window.__fakeTelegram.setPush(false);
            window.__fakeTelegram.incoming('1003', 'Sem push', 'Carla Dias');
          });
          await page.waitForTimeout(2000);
          assert.equal(await page.getByText('Sem push').count(), 0, 'not pushed');
          await waitForText(page, 'Sem push', 12000);
        } finally {
          await context.close();
        }
      });

      await test('[chromium] connection lost while open: Offline in the header, then back', async () => {
        const {context, page} = await newPage(browser, {values: ACCOUNT});
        try {
          await page.goto(`${FAKE_APP}/`);
          await waitForText(page, 'Ana Souza');
          await fake(page, () => window.__fakeTelegram.setPollFails(true));
          await fake(page, () => window.__fakeTelegram.incoming('1005', 'ping', 'Diego Alves'));
          await waitForText(page, 'Offline', 5000);
          await fake(page, () => window.__fakeTelegram.setPollFails(false));
          await fake(page, () => window.__fakeTelegram.incoming('1005', 'pong', 'Diego Alves'));
          await page.waitForFunction(() => !document.body.innerText.includes('Offline'), null, {timeout: 5000});
        } finally {
          await context.close();
        }
      });

      await test('[chromium] window.lumen.config contract (get + onChange), URL fallback ignored', async () => {
        const {context, page, problems} = await newPage(browser, {values: ACCOUNT});
        try {
          await page.goto(`${FAKE_APP}/?telegram.apiId=999`);
          await waitForText(page, 'Ana Souza');
          assert.equal(new URL(page.url()).search, '', 'URL parameters are stripped');
          await page.evaluate(values => window.__lumenSet(values), {...ACCOUNT, 'telegram.apiId': '401'});
          await waitForText(page, 'Session not accepted');
          await page.evaluate(values => window.__lumenSet(values), ACCOUNT);
          await waitForText(page, 'Ana Souza');
          await page.evaluate(values => window.__lumenSet(values), {...ACCOUNT, demo: 'yes'});
          await page.waitForTimeout(800);
          assert.ok((await page.content()).includes('Ana Souza'), 'any other demo value keeps the account');
          await page.evaluate(values => window.__lumenSet(values), DEMO);
          await waitForText(page, 'Maya Chen');
          await page.waitForTimeout(600);
          assert.ok(!(await page.content()).includes('Ana Souza'), 'no account data in demo mode');
          await page.evaluate(() => window.__lumenSet({'telegram.apiId': '12345'}));
          await waitForText(page, 'Connect Telegram');
          await waitForText(page, 'API hash and Session');
          assert.deepEqual(problems, []);
        } finally {
          await context.close();
        }
      });

      await test('[chromium] release build: GramJS loads only for an account; Telegram blocked → "Can\'t reach Telegram"', async () => {
        if (process.env.E2E_SKIP_SLOW) {
          console.log('     (skipped: slow)');
          return;
        }
        // Telegram's hosts do not resolve, as when the phone has no internet.
        const offline = await chromium.launch({args: ['--host-resolver-rules=MAP *.telegram.org ~NOTFOUND']});
        const {context, page, blocked} = await newPage(offline, {values: ACCOUNT, block: APP});
        try {
          const started = Date.now();
          await page.goto(`${APP}/`);
          await waitForText(page, 'Loading…', 3000);
          await waitForText(page, "Can't reach Telegram", 90000);
          assert.ok(Date.now() - started >= 25000, 'retried for about 30 s');
          const loaded = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
          assert.ok(loaded.some(name => /gramClient-.*\.js$/.test(name)), 'GramJS chunk loaded');
          const sockets = await page.evaluate(() => window.__webSockets);
          assert.ok(sockets.some(url => /^wss:\/\/\w+\.web\.telegram\.org(:443)?\/apiws/.test(url)), `WebSocket to Telegram attempted: ${sockets.slice(0, 3)}`);
          void blocked;
          await page.screenshot({path: path.join(outDir, 'error-network.png')});
        } finally {
          await context.close();
          await offline.close();
        }
      });

      await test('[chromium] offline package (.mrbd.zip) in demo mode: capture script with every outside request blocked', async () => {
        const pkg = await chromium.launch();
        try {
          await demoFlow(pkg, 'package', PACKAGE_APP);
        } finally {
          await pkg.close();
        }
      });
    } finally {
      await browser.close();
    }
  } finally {
    releaseServer.close();
    fakeServer.close();
    packageServer.close();
  }

  const failed = results.filter(result => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
}

await run();
