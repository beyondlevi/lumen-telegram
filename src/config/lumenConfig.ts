// Configuration contract with the Lumen platform.
//
// On the glasses the platform injects `window.lumen.config`, backed by the
// fields declared under `lumen_config` in manifest.webmanifest and filled in on
// the phone companion. The Telegram session is a full credential for the
// account: it lives only in the platform's config (and in memory here), never
// in localStorage or in the bundle.
//
// In a regular browser (development only) `window.lumen` does not exist, so the
// values come from `?telegram.apiId=…&telegram.apiHash=…&telegram.session=…`
// (or `?demo=demo-captures`). They are kept in memory for this page load only
// and removed from the address bar right after they are read.
//
// Demo mode: the optional `demo` field set to exactly `demo-captures` replaces
// Telegram with built-in fictional chats (src/demo). Any other value, or an
// empty field, is ignored.

export const CONFIG_KEYS = {
  apiId: 'telegram.apiId',
  apiHash: 'telegram.apiHash',
  session: 'telegram.session',
} as const;

/** Optional `lumen_config` field that turns on demo mode. */
export const DEMO_KEY = 'demo';
/** The only value of DEMO_KEY that turns on demo mode. */
export const DEMO_ACTIVATION = 'demo-captures';

const URL_KEYS: readonly string[] = [...Object.values(CONFIG_KEYS), DEMO_KEY];

export type ConfigField = keyof typeof CONFIG_KEYS;
export const CONFIG_FIELDS: readonly ConfigField[] = ['apiId', 'apiHash', 'session'];

export type ConfigValues = Record<string, string>;

export type TelegramConfig = {
  apiId: number;
  apiHash: string;
  /** GramJS StringSession. */
  session: string;
};

export type ConfigState =
  | {status: 'loading'}
  | {status: 'missing'; missing: ConfigField[]}
  | {status: 'invalid'; field: ConfigField}
  | {status: 'ready'; config: TelegramConfig}
  | {status: 'demo'};

type LumenConfigApi = {
  get(): Promise<ConfigValues>;
  onChange(callback: (values?: ConfigValues) => void): unknown;
};

declare global {
  interface Window {
    lumen?: {config?: LumenConfigApi};
  }
}

export type ConfigSource = {
  kind: 'lumen' | 'dev';
  get(): Promise<ConfigValues>;
  /** Calls back with the new values when known, or with nothing (caller re-reads). */
  subscribe(callback: (values?: ConfigValues) => void): () => void;
};

/** The parts of `window` this module uses (lets tests pass a plain object). */
export type HostWindow = {
  location: {href: string};
  history: {state: unknown; replaceState(state: unknown, unused: string, url: string): void};
  lumen?: {config?: LumenConfigApi};
};

/** Development values from the URL, for this page load only. */
const devValues: ConfigValues = {};

/**
 * Development fallback: reads `telegram.*` and `demo` URL parameters into
 * memory and strips them from the address bar so the session does not linger
 * in the URL or in history. Always strips; only keeps them when `keep` is true.
 */
export function captureDevConfigFromUrl(keep: boolean, win: HostWindow = window, target: ConfigValues = devValues): void {
  const url = new URL(win.location.href);
  const keys = URL_KEYS.filter(key => url.searchParams.has(key));
  if (keys.length === 0) {
    return;
  }
  if (keep) {
    for (const key of keys) {
      const value = (url.searchParams.get(key) ?? '').trim();
      if (value) {
        target[key] = value;
      } else {
        delete target[key];
      }
    }
  }
  for (const key of keys) {
    url.searchParams.delete(key);
  }
  win.history.replaceState(win.history.state, '', url.pathname + url.search + url.hash);
}

export function getConfigSource(win: HostWindow = window, dev: ConfigValues = devValues): ConfigSource {
  const lumenConfig = win.lumen?.config;
  if (lumenConfig != null && typeof lumenConfig.get === 'function') {
    return {
      kind: 'lumen',
      get: () => lumenConfig.get(),
      subscribe(callback) {
        if (typeof lumenConfig.onChange !== 'function') {
          return () => {};
        }
        const unsubscribe = lumenConfig.onChange(values =>
          callback(values != null && typeof values === 'object' ? values : undefined),
        );
        return typeof unsubscribe === 'function' ? () => unsubscribe() : () => {};
      },
    };
  }
  return {
    kind: 'dev',
    get: () => Promise.resolve({...dev}),
    subscribe: () => () => {},
  };
}

export function isDemoActivation(values: ConfigValues | null | undefined): boolean {
  const value = values?.[DEMO_KEY];
  return typeof value === 'string' && value.trim() === DEMO_ACTIVATION;
}

/** GramJS StringSession: version "1" followed by base64 (dc, address, port, 256-byte key). */
const SESSION_PATTERN = /^1[A-Za-z0-9+/_-]{300,}={0,2}$/;

/**
 * Checks the layout GramJS's StringSession reads: data center (1–5 in
 * Telegram's production network), server address (IPv4/IPv6 or text, or the
 * fixed Telethon layout), port, and the 256-byte authorization key.
 */
function isSessionLayout(session: string): boolean {
  let bytes: Uint8Array;
  try {
    const binary = atob(session.slice(1).replace(/-/g, '+').replace(/_/g, '/'));
    bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  } catch {
    return false;
  }
  if (bytes.length === 0 || bytes[0] < 1 || bytes[0] > 5) {
    return false;
  }
  if (session.length === 353) {
    // Telethon layout: dc, IPv4, port, key.
    return bytes.length === 1 + 4 + 2 + 256;
  }
  const addressLength = (bytes[1] << 8) | bytes[2];
  if (addressLength > 100) {
    // IPv6 stored as 16 raw bytes.
    return bytes.length === 1 + 16 + 2 + 256;
  }
  return bytes.length === 1 + 2 + addressLength + 2 + 256;
}

export function parseConfig(values: ConfigValues | null | undefined): ConfigState {
  if (isDemoActivation(values)) {
    return {status: 'demo'};
  }
  const read = (field: ConfigField) => {
    const value = values?.[CONFIG_KEYS[field]];
    return typeof value === 'string' ? value.trim() : '';
  };
  const missing = CONFIG_FIELDS.filter(field => read(field) === '');
  if (missing.length > 0) {
    return {status: 'missing', missing};
  }
  const apiId = read('apiId');
  if (!/^\d{1,10}$/.test(apiId) || Number(apiId) <= 0) {
    return {status: 'invalid', field: 'apiId'};
  }
  const apiHash = read('apiHash');
  if (!/^[0-9a-f]{32}$/i.test(apiHash)) {
    return {status: 'invalid', field: 'apiHash'};
  }
  const session = read('session').replace(/\s+/g, '');
  if (!SESSION_PATTERN.test(session) || !isSessionLayout(session)) {
    return {status: 'invalid', field: 'session'};
  }
  return {status: 'ready', config: {apiId: Number(apiId), apiHash: apiHash.toLowerCase(), session}};
}

export function sameConfig(a: ConfigState, b: ConfigState): boolean {
  if (a.status !== b.status) {
    return false;
  }
  if (a.status === 'ready' && b.status === 'ready') {
    return (
      a.config.apiId === b.config.apiId &&
      a.config.apiHash === b.config.apiHash &&
      a.config.session === b.config.session
    );
  }
  if (a.status === 'missing' && b.status === 'missing') {
    return a.missing.join() === b.missing.join();
  }
  if (a.status === 'invalid' && b.status === 'invalid') {
    return a.field === b.field;
  }
  return true;
}

/**
 * Cache key for an account: a short one-way digest of the API ID and session,
 * so cached chats of one account never show for another. The session itself is
 * never stored.
 */
export function accountKey(config: TelegramConfig): string {
  const input = `${config.apiId}:${config.session}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x5bd1e995) >>> 0;
  }
  return `tg-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}
