// Contract with the Lumen host for the glasses' microphone. On the Rokid
// glasses getUserMedia is muted for apps, so the phone captures the glasses'
// microphone and transcribes; the host exposes that as `window.lumen.audio`.
// Older hosts have no `audio`: then voice recording and transcription are off.

export const RECORD_LIMIT_MS = 120000;

export type LumenAudioErrorCode =
  | 'busy'
  | 'no-phone'
  | 'unavailable'
  | 'too-large'
  | 'unsupported-format'
  | 'no-speech'
  | 'engine'
  | 'cancelled'
  | 'timeout';

export type LumenAudioResult = {blob: Blob; mimeType: string; durationMs: number};

export type LumenAudioError = Error & {code?: LumenAudioErrorCode | string};

export type LumenRecording = {
  /** Level 0..1 and elapsed time, about 5 times per second. */
  onLevel: ((level: number, elapsedMs: number) => void) | null;
  /** The recording ended by itself: 'max' (result holds the audio) or 'error'. */
  onEnd: ((reason: 'max' | 'error', result?: LumenAudioResult, error?: LumenAudioError) => void) | null;
  stop(): Promise<LumenAudioResult>;
  cancel(): void;
};

export type LumenAudio = {
  record(options?: {maxMs?: number}): Promise<LumenRecording>;
  transcribe(
    audio: Blob,
    options?: {language?: string; onPartial?: (text: string) => void; signal?: AbortSignal},
  ): Promise<{text: string}>;
};

declare global {
  interface LumenHost {
    audio?: LumenAudio;
  }
}

/** The host's audio API, or null when this Lumen version has none. */
export function hostAudio(win: {lumen?: {audio?: unknown}} = window): LumenAudio | null {
  const audio = win.lumen?.audio as Partial<LumenAudio> | undefined;
  return audio && typeof audio.record === 'function' && typeof audio.transcribe === 'function'
    ? (audio as LumenAudio)
    : null;
}

/** Error code of a rejection from the audio API ('' when it has none). */
export function audioErrorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : '';
}
