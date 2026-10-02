import {TelegramError} from './api';

/** Errors that mean the session or the API ID/hash will not work again: a new session is needed. */
const AUTH_ERRORS = new Set([
  'AUTH_KEY_UNREGISTERED',
  'AUTH_KEY_INVALID',
  'AUTH_KEY_PERM_EMPTY',
  'AUTH_KEY_DUPLICATED',
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'SESSION_PASSWORD_NEEDED',
  'USER_DEACTIVATED',
  'USER_DEACTIVATED_BAN',
  'API_ID_INVALID',
  'API_ID_PUBLISHED_FLOOD',
  'AUTH_KEY_UNKNOWN',
]);

const NETWORK_HINTS = /not connected|timed? ?out|websocket|network|connection|socket|ECONN|failed to fetch/i;

/** Maps a GramJS/MTProto error (RPCError, FloodWaitError, transport errors) to a TelegramError. */
export function toTelegramError(error: unknown): TelegramError {
  if (error instanceof TelegramError) {
    return error;
  }
  const value = (error ?? {}) as {errorMessage?: unknown; message?: unknown; seconds?: unknown; code?: unknown};
  const code = typeof value.errorMessage === 'string' ? value.errorMessage : null;
  const message = typeof value.message === 'string' ? value.message : String(error);
  if (code) {
    if (AUTH_ERRORS.has(code)) {
      return new TelegramError('auth', message, code);
    }
    const flood = /^(?:FLOOD_WAIT|SLOWMODE_WAIT|FLOOD_PREMIUM_WAIT)_(\d+)$/.exec(code);
    if (flood || code === 'FLOOD_WAIT') {
      const seconds = flood ? Number(flood[1]) : typeof value.seconds === 'number' ? value.seconds : null;
      return new TelegramError('flood', message, code, seconds);
    }
    if (typeof value.code === 'number' && value.code >= 400 && value.code < 500) {
      return new TelegramError('rejected', message, code);
    }
    return new TelegramError('server', message, code);
  }
  if (NETWORK_HINTS.test(message)) {
    return new TelegramError('network', message);
  }
  return new TelegramError('server', message);
}
