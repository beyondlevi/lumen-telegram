import type {TelegramConfig} from '../config/lumenConfig';
import type {ChatApi} from './api';

/** Loads GramJS (a separate chunk) only when a real account is configured, then connects. */
export async function connectClient(config: TelegramConfig, options: {timeoutMs?: number} = {}): Promise<ChatApi> {
  const {connectTelegram} = await import('./gramClient');
  return connectTelegram(config, options);
}
