import {describe, expect, it} from 'vitest';
import {TelegramError} from '../../src/telegram/api';
import {toTelegramError} from '../../src/telegram/errors';

const rpc = (errorMessage: string, code = 400) => Object.assign(new Error(errorMessage), {errorMessage, code});

describe('toTelegramError', () => {
  it('maps refused sessions and API IDs to auth', () => {
    for (const code of ['AUTH_KEY_UNREGISTERED', 'SESSION_REVOKED', 'USER_DEACTIVATED_BAN', 'API_ID_INVALID']) {
      expect(toTelegramError(rpc(code, 401))).toMatchObject({kind: 'auth', code});
    }
  });

  it('reads flood waits', () => {
    expect(toTelegramError(rpc('FLOOD_WAIT_42', 420))).toMatchObject({kind: 'flood', waitSeconds: 42});
    expect(toTelegramError(Object.assign(new Error('x'), {errorMessage: 'FLOOD_WAIT', seconds: 7}))).toMatchObject({kind: 'flood', waitSeconds: 7});
  });

  it('separates rejected requests, server errors and transport failures', () => {
    expect(toTelegramError(rpc('REACTION_INVALID'))).toMatchObject({kind: 'rejected', code: 'REACTION_INVALID'});
    expect(toTelegramError(rpc('INTERNAL', 500))).toMatchObject({kind: 'server'});
    expect(toTelegramError(new Error('Not connected'))).toMatchObject({kind: 'network'});
    expect(toTelegramError(new Error('WebSocket connection failed'))).toMatchObject({kind: 'network'});
    expect(toTelegramError(new Error('Something odd'))).toMatchObject({kind: 'server'});
    const own = new TelegramError('auth', 'x', 'AUTH_KEY_UNKNOWN');
    expect(toTelegramError(own)).toBe(own);
  });
});
