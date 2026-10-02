import type {TelegramErrorKind} from './telegram/api';
import {t, type StringKey} from './i18n/strings';

const FAILURE_REASONS: Record<TelegramErrorKind, StringKey> = {
  network: 'reasonNetwork',
  auth: 'reasonAuth',
  rejected: 'reasonRejected',
  flood: 'reasonFlood',
  server: 'reasonServer',
};

/** Short reason for a failed Telegram call, for toasts and error copy. */
export function failureReason(error: unknown): string {
  if (error instanceof Error && 'code' in error && error.code === 'MEDIA_FORMAT') {
    return t('reasonFormat');
  }
  const kind = error instanceof Error && 'kind' in error ? String(error.kind) : '';
  return t(kind in FAILURE_REASONS ? FAILURE_REASONS[kind as TelegramErrorKind] : 'reasonServer');
}
