import {describe, expect, it} from 'vitest';
import {resolveLocale, translate} from '../../src/i18n/strings';

describe('locale', () => {
  it('uses the base language', () => {
    expect(resolveLocale(['pt-PT'])).toBe('pt');
    expect(resolveLocale(['pt-BR'])).toBe('pt');
    expect(resolveLocale(['PT'])).toBe('pt');
    expect(resolveLocale(['en-US'])).toBe('en');
    expect(resolveLocale(['de-DE'])).toBe('en');
    expect(resolveLocale([])).toBe('en');
  });

  it('fills parameters in both languages', () => {
    expect(translate('en', 'replyFieldLabel', {name: 'Ana'})).toBe('Reply to Ana');
    expect(translate('pt', 'replyFieldLabel', {name: 'Ana'})).toBe('Responder a Ana');
    expect(translate('pt', 'markerAudio')).toBe('Áudio');
    expect(translate('pt', 'markerPhoto')).toBe('Foto');
  });

  it('keeps header titles and metadata within two words', () => {
    for (const target of ['en', 'pt'] as const) {
      for (const key of ['chatsHeader', 'setupHeader', 'loadingHeader', 'errorHeader', 'offlineMeta'] as const) {
        expect(translate(target, key).split(/\s+/).length).toBeLessThanOrEqual(2);
      }
    }
  });
});
