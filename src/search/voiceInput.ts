// Hearing one short phrase (a name) from the wearer. Lumen offers two ways:
// the Web Speech API's SpeechRecognition (live partial text, ends on a pause)
// and window.lumen.audio (record, then transcribe). The first is preferred;
// where it fails as unavailable the second is used. Without either (a desktop
// browser without speech, Meta Ray-Ban Display's browser today) voice search
// is not offered.

import {audioErrorCode, hostAudio, type LumenAudio, type LumenRecording} from '../audio/lumenAudio';

export type VoiceErrorCode = 'no-speech' | 'unavailable' | 'busy' | 'no-phone' | 'network' | 'failed';

export type VoiceEvents = {
  /** Text heard so far. */
  onPartial(text: string): void;
  /** Input level 0..1 while recording (window.lumen.audio only). */
  onLevel?(level: number): void;
  /** Recording ended; the audio is being turned into text (window.lumen.audio only). */
  onRecognizing?(): void;
  /** Final text (not empty). */
  onResult(text: string): void;
  onError(code: VoiceErrorCode, message?: string): void;
};

export type Listening = {
  /** Stops listening and keeps what was said. */
  finish(): void;
  /** Stops without a result; no event follows. */
  cancel(): void;
};

export type VoiceInput = {
  kind: 'speech-recognition' | 'lumen-audio' | 'demo';
  listen(events: VoiceEvents, language: string): Listening;
};

// --------------------------------------------------------------- SpeechRecognition

type RecognitionAlternative = {transcript: string};
type RecognitionResult = {isFinal: boolean; length: number; [index: number]: RecognitionAlternative};
type RecognitionResultEvent = {results: {length: number; [index: number]: RecognitionResult}};
type RecognitionErrorEvent = {error: string; message?: string};

/** The part of the Web Speech API recognizer used here. */
export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const RECOGNITION_ERRORS: Record<string, VoiceErrorCode> = {
  'no-speech': 'no-speech',
  'not-allowed': 'unavailable',
  'service-not-allowed': 'unavailable',
  'audio-capture': 'unavailable',
  'language-not-supported': 'unavailable',
  unavailable: 'unavailable',
  network: 'network',
  timeout: 'network',
  busy: 'busy',
  'no-phone': 'no-phone',
};

export function speechRecognitionInput(Recognition: SpeechRecognitionConstructor): VoiceInput {
  return {
    kind: 'speech-recognition',
    listen(events, language) {
      const recognition = new Recognition();
      recognition.lang = language;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      let finalText = '';
      let interimText = '';
      let error: {code: VoiceErrorCode; message?: string} | null = null;
      let over = false;

      recognition.onresult = event => {
        let finals = '';
        let interim = '';
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = result[0]?.transcript ?? '';
          if (result.isFinal) {
            finals += text;
          } else {
            interim += text;
          }
        }
        finalText = finals.trim();
        interimText = interim.trim();
        events.onPartial(`${finalText} ${interimText}`.trim());
      };
      recognition.onerror = event => {
        if (event.error !== 'aborted') {
          error = {code: RECOGNITION_ERRORS[event.error] ?? 'failed', message: event.message || event.error};
        }
      };
      recognition.onend = () => {
        if (over) {
          return;
        }
        over = true;
        const text = finalText || interimText;
        if (text) {
          events.onResult(text);
        } else {
          events.onError(error?.code ?? 'no-speech', error?.message);
        }
      };
      try {
        recognition.start();
      } catch (failure) {
        over = true;
        const message = failure instanceof Error ? failure.message : String(failure);
        queueMicrotask(() => events.onError('failed', message));
      }
      return {
        finish: () => {
          if (!over) {
            recognition.stop();
          }
        },
        cancel: () => {
          if (!over) {
            over = true;
            recognition.abort();
          }
        },
      };
    },
  };
}

// --------------------------------------------------------------- window.lumen.audio

/** Longest recording for a name. */
export const NAME_RECORD_MS = 10000;
/** Input level above which the wearer is speaking (speech reaches 0.15–0.3). */
const SPEAKING_LEVEL = 0.1;
/** Below this, after speaking, the wearer has paused. */
const QUIET_LEVEL = 0.06;
/** A pause this long after speaking ends the recording. */
const PAUSE_MS = 1200;
/** Nothing said for this long ends the recording. */
const NOTHING_SAID_MS = 6000;

const AUDIO_ERRORS: Record<string, VoiceErrorCode> = {
  'no-speech': 'no-speech',
  unavailable: 'unavailable',
  busy: 'busy',
  'no-phone': 'no-phone',
  timeout: 'network',
};

/** Ends a recording after a pause that follows speech, as SpeechRecognition does. */
export function pauseDetector(onPause: () => void) {
  let spoke = false;
  let quietSince: number | null = null;
  return (level: number, elapsedMs: number) => {
    if (level >= SPEAKING_LEVEL) {
      spoke = true;
      quietSince = null;
    } else if (level < QUIET_LEVEL) {
      quietSince ??= elapsedMs;
    }
    if ((spoke && quietSince != null && elapsedMs - quietSince >= PAUSE_MS) || (!spoke && elapsedMs >= NOTHING_SAID_MS)) {
      onPause();
    }
  };
}

export function lumenAudioInput(audio: LumenAudio): VoiceInput {
  return {
    kind: 'lumen-audio',
    listen(events, language) {
      const controller = new AbortController();
      let over = false;
      let finishing = false;
      let recording: LumenRecording | null = null;

      const fail = (error: unknown) => {
        if (over) {
          return;
        }
        over = true;
        const code = audioErrorCode(error);
        if (code === 'cancelled') {
          return;
        }
        events.onError(AUDIO_ERRORS[code] ?? 'failed', error instanceof Error ? error.message : String(error));
      };

      const transcribe = async (blob: Blob) => {
        events.onRecognizing?.();
        try {
          const {text} = await audio.transcribe(blob, {
            language,
            signal: controller.signal,
            onPartial: partial => {
              if (!over) {
                events.onPartial(partial.trim());
              }
            },
          });
          if (over) {
            return;
          }
          over = true;
          if (text.trim()) {
            events.onResult(text.trim());
          } else {
            events.onError('no-speech');
          }
        } catch (error) {
          fail(error);
        }
      };

      const finish = () => {
        if (over || finishing) {
          return;
        }
        finishing = true;
        void started.then(
          current => current.stop().then(result => (over ? undefined : transcribe(result.blob)), fail),
          fail,
        );
      };

      const onPause = pauseDetector(finish);
      const started = audio.record({maxMs: NAME_RECORD_MS});
      started.then(
        current => {
          recording = current;
          if (over) {
            current.cancel();
            return;
          }
          current.onLevel = (level, elapsedMs) => {
            if (!over && !finishing) {
              events.onLevel?.(level);
              onPause(level, elapsedMs);
            }
          };
          current.onEnd = (reason, result, error) => {
            if (over || finishing) {
              return;
            }
            finishing = true;
            if (reason === 'max' && result) {
              void transcribe(result.blob);
            } else {
              fail(error ?? new Error('recording failed'));
            }
          };
        },
        fail,
      );

      return {
        finish,
        cancel: () => {
          if (over) {
            return;
          }
          over = true;
          controller.abort();
          recording?.cancel();
          void started.then(current => current.cancel(), () => undefined);
        },
      };
    },
  };
}

// --------------------------------------------------------------- demo

/**
 * Demo mode (screenshots and videos): "hears" `phrase` word by word, with the
 * timing of the glasses' dictation, without a microphone.
 */
export function demoVoiceInput(phrase: string): VoiceInput {
  return {
    kind: 'demo',
    listen(events) {
      const said = phrase.split(' ');
      let heard = 0;
      let over = false;
      const timers: number[] = [];
      const end = () => {
        if (over) {
          return;
        }
        over = true;
        timers.forEach(timer => window.clearTimeout(timer));
        const text = said.slice(0, Math.max(heard, 1)).join(' ');
        events.onResult(text);
      };
      said.forEach((_, index) => {
        timers.push(
          window.setTimeout(() => {
            heard = index + 1;
            events.onPartial(said.slice(0, heard).join(' '));
          }, 900 + index * 400),
        );
      });
      timers.push(window.setTimeout(end, 900 + said.length * 400 + 900));
      return {
        finish: end,
        cancel: () => {
          over = true;
          timers.forEach(timer => window.clearTimeout(timer));
        },
      };
    },
  };
}

// --------------------------------------------------------------- choice

type SpeechWindow = {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  lumen?: {audio?: unknown};
};

/** Recognizers this page offers, best first (empty: no voice search). */
export function availableVoiceInputs(win: SpeechWindow = window as SpeechWindow): VoiceInput[] {
  const inputs: VoiceInput[] = [];
  const Recognition = win.SpeechRecognition ?? win.webkitSpeechRecognition;
  if (typeof Recognition === 'function') {
    inputs.push(speechRecognitionInput(Recognition as SpeechRecognitionConstructor));
  }
  const audio = hostAudio(win);
  if (audio) {
    inputs.push(lumenAudioInput(audio));
  }
  return inputs;
}
