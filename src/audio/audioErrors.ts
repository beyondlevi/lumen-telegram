import {t, type StringKey} from '../i18n/strings';
import {audioErrorCode} from './lumenAudio';

const MESSAGES: Record<string, StringKey> = {
  busy: 'audioBusy',
  'no-phone': 'audioNoPhone',
  unavailable: 'audioUnavailable',
  'too-large': 'audioTooLarge',
  'unsupported-format': 'audioUnsupported',
  'no-speech': 'audioNoSpeech',
  timeout: 'audioTimeout',
};

/** What to tell the user about a failed recording or transcription. */
export function audioErrorMessage(error: unknown): string {
  const code = audioErrorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  if (code === 'engine') {
    return t('audioEngine', {message});
  }
  return code in MESSAGES ? t(MESSAGES[code]) : t('audioOther', {message});
}
