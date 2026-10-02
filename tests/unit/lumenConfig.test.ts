import {describe, expect, it, vi} from 'vitest';
import {
  accountKey,
  captureDevConfigFromUrl,
  getConfigSource,
  parseConfig,
  sameConfig,
  type ConfigValues,
  type HostWindow,
} from '../../src/config/lumenConfig';

/** GramJS layout: data center 2, address "149.154.167.51", port 443, a 256-byte key. */
function layoutSession(dc = 2): string {
  const address = '149.154.167.51';
  const bytes = [dc, 0, address.length, ...Array.from(address, char => char.charCodeAt(0)), 1, 187, ...new Array(256).fill(7)];
  return `1${btoa(String.fromCharCode(...bytes))}`;
}
const SESSION = layoutSession();
const VALID = {'telegram.apiId': '12345', 'telegram.apiHash': '0123456789ABCDEF0123456789abcdef', 'telegram.session': SESSION};

function fakeWindow(href: string, extra: Pick<HostWindow, 'lumen'> = {}) {
  const win = {
    location: new URL(href),
    history: {
      state: {idx: 0},
      replaceState: vi.fn((_state: unknown, _title: string, url: string) => {
        win.location = new URL(url, win.location.href);
      }),
    },
    ...extra,
  };
  return win;
}

describe('parseConfig', () => {
  it('lists missing keys', () => {
    expect(parseConfig({})).toEqual({status: 'missing', missing: ['apiId', 'apiHash', 'session']});
    expect(parseConfig({'telegram.apiId': '1', 'telegram.apiHash': ' '})).toEqual({status: 'missing', missing: ['apiHash', 'session']});
  });

  it('names the invalid field', () => {
    expect(parseConfig({...VALID, 'telegram.apiId': 'abc'})).toEqual({status: 'invalid', field: 'apiId'});
    expect(parseConfig({...VALID, 'telegram.apiId': '0'})).toEqual({status: 'invalid', field: 'apiId'});
    expect(parseConfig({...VALID, 'telegram.apiHash': 'xyz'})).toEqual({status: 'invalid', field: 'apiHash'});
    expect(parseConfig({...VALID, 'telegram.session': 'not-a-session'})).toEqual({status: 'invalid', field: 'session'});
    expect(parseConfig({...VALID, 'telegram.session': `2${'A'.repeat(350)}`})).toEqual({status: 'invalid', field: 'session'});
    // Data center 0 (or above 5), or a wrong length, is not a session GramJS can read.
    expect(parseConfig({...VALID, 'telegram.session': layoutSession(0)})).toEqual({status: 'invalid', field: 'session'});
    expect(parseConfig({...VALID, 'telegram.session': `1${'A'.repeat(350)}`})).toEqual({status: 'invalid', field: 'session'});
    expect(parseConfig({...VALID, 'telegram.session': `${SESSION.slice(0, -8)}`})).toEqual({status: 'invalid', field: 'session'});
  });

  it('normalizes a valid configuration (session pasted with line breaks)', () => {
    const pasted = `${SESSION.slice(0, 100)}\n${SESSION.slice(100)}`;
    expect(parseConfig({...VALID, 'telegram.session': pasted})).toEqual({
      status: 'ready',
      config: {apiId: 12345, apiHash: '0123456789abcdef0123456789abcdef', session: SESSION},
    });
  });
});

describe('sessions printed by npm run login', () => {
  it('are accepted for every data center, IPv4 or IPv6', async () => {
    const {StringSession} = await import('telegram/sessions/index.js');
    const {AuthKey} = await import('telegram/crypto/AuthKey.js');
    const {Buffer} = await import('buffer');
    for (const [dc, address] of [[1, '149.154.175.53'], [2, '149.154.167.51'], [4, '2001:067c:04e8:f004:0000:0000:0000:000a'], [5, '91.108.56.130']] as const) {
      const session = new StringSession('');
      const key = new AuthKey();
      await key.setKey(Buffer.alloc(256, dc));
      session.setDC(dc, address, 443);
      session.setAuthKey(key);
      expect(parseConfig({...VALID, 'telegram.session': session.save()})).toMatchObject({status: 'ready'});
    }
  });
});

describe('demo mode', () => {
  it('turns on only with the exact activation value', () => {
    expect(parseConfig({demo: 'demo-captures'})).toEqual({status: 'demo'});
    expect(parseConfig({...VALID, demo: ' demo-captures '})).toEqual({status: 'demo'});
    for (const demo of ['', 'demo', 'yes', 'Demo-Captures']) {
      expect(parseConfig({...VALID, demo})).toMatchObject({status: 'ready'});
    }
  });
});

describe('credentials stay out of storage', () => {
  it('the development fallback keeps URL values in memory and strips them', () => {
    const memory: ConfigValues = {};
    const win = fakeWindow(`http://localhost/chat/1?telegram.session=${SESSION}&telegram.apiId=1&keep=1`);
    captureDevConfigFromUrl(true, win, memory);
    expect(memory).toEqual({'telegram.session': SESSION, 'telegram.apiId': '1'});
    expect(win.history.replaceState).toHaveBeenCalledWith({idx: 0}, '', '/chat/1?keep=1');
  });

  it('ignores URL values when the platform config exists, but still strips them', () => {
    const memory: ConfigValues = {};
    const win = fakeWindow('http://127.0.0.1/?demo=demo-captures');
    captureDevConfigFromUrl(false, win, memory);
    expect(memory).toEqual({});
    expect(win.history.replaceState).toHaveBeenCalled();
  });

  it('the cache key does not contain the session or API hash', () => {
    const config = {apiId: 12345, apiHash: VALID['telegram.apiHash'].toLowerCase(), session: SESSION};
    const key = accountKey(config);
    expect(key).toMatch(/^tg-[0-9a-f]{16}$/);
    expect(key).toBe(accountKey({...config}));
    expect(key).not.toBe(accountKey({...config, session: `${SESSION}A`}));
  });
});

describe('window.lumen.config', () => {
  it('uses the platform API and its onChange callback', async () => {
    let changeCallback: ((values?: Record<string, string>) => void) | undefined;
    const unsubscribe = vi.fn();
    const lumen = {
      config: {
        get: vi.fn(async () => VALID),
        onChange: vi.fn((callback: (values?: Record<string, string>) => void) => {
          changeCallback = callback;
          return unsubscribe;
        }),
      },
    };
    const source = getConfigSource(fakeWindow('http://127.0.0.1/', {lumen}));
    expect(source.kind).toBe('lumen');
    await expect(source.get()).resolves.toEqual(VALID);
    const seen: Array<Record<string, string> | undefined> = [];
    const stop = source.subscribe(values => seen.push(values));
    changeCallback?.({demo: 'demo-captures'});
    changeCallback?.();
    expect(seen).toEqual([{demo: 'demo-captures'}, undefined]);
    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('compares states field by field', () => {
    expect(sameConfig(parseConfig(VALID), parseConfig({...VALID}))).toBe(true);
    expect(sameConfig(parseConfig(VALID), parseConfig({...VALID, 'telegram.apiId': '9'}))).toBe(false);
    expect(sameConfig({status: 'invalid', field: 'apiId'}, {status: 'invalid', field: 'session'})).toBe(false);
  });
});
