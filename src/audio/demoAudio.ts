// Simulated `window.lumen.audio` for demo mode: an animated input level, a
// "recording" that is the packaged demo voice note, and a fixed English
// transcription delivered word by word. No microphone, no network, no storage.
import voiceNote from '../demo/assets/voice-note.ogg';
import {RECORD_LIMIT_MS, type LumenAudio, type LumenAudioError, type LumenAudioResult, type LumenRecording} from './lumenAudio';

const LEVEL_INTERVAL_MS = 200;
const START_DELAY_MS = 300;
const WORD_INTERVAL_MS = 150;

export const DEMO_TRANSCRIPT =
  "Morning! Quick update: I'm on my way and should be there in about ten minutes. Save me a seat, see you soon.";

function audioError(code: string, message: string): LumenAudioError {
  return Object.assign(new Error(message), {code});
}

async function demoBlob(): Promise<Blob> {
  const url = typeof location === 'undefined' ? voiceNote : new URL(voiceNote, location.href).href;
  const response = await fetch(url);
  return new Blob([await response.arrayBuffer()], {type: 'audio/ogg'});
}

/** A speech-like level between 0 and 1 for time t (ms). */
export function demoLevel(t: number): number {
  const syllables = Math.abs(Math.sin(t / 130)) * 0.55;
  const phrases = Math.max(0, Math.sin(t / 900)) * 0.4;
  return Math.min(1, 0.05 + syllables * (0.4 + phrases));
}

export function createDemoAudio(): LumenAudio {
  let active = false;
  return {
    async record(options = {}) {
      if (active) {
        throw audioError('busy', 'Another recording is in progress');
      }
      active = true;
      const maxMs = Math.min(options.maxMs ?? RECORD_LIMIT_MS, RECORD_LIMIT_MS);
      await new Promise(resolve => setTimeout(resolve, START_DELAY_MS));
      const startedAt = Date.now();
      let done = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      const finish = () => {
        done = true;
        active = false;
        clearInterval(timer);
      };
      const result = async (): Promise<LumenAudioResult> => ({
        blob: await demoBlob(),
        mimeType: 'audio/ogg; codecs=opus',
        durationMs: Math.min(Date.now() - startedAt, maxMs),
      });
      const recording: LumenRecording = {
        onLevel: null,
        onEnd: null,
        async stop() {
          if (done) {
            throw audioError('cancelled', 'The recording already ended');
          }
          finish();
          return result();
        },
        cancel() {
          finish();
        },
      };
      timer = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= maxMs) {
          finish();
          void result().then(audio => recording.onEnd?.('max', audio));
          return;
        }
        recording.onLevel?.(demoLevel(elapsed), elapsed);
      }, LEVEL_INTERVAL_MS);
      return recording;
    },

    transcribe(_audio, options = {}) {
      return new Promise((resolve, reject) => {
        const words = DEMO_TRANSCRIPT.split(' ');
        let index = 0;
        const timer = setInterval(() => {
          index += 1;
          if (index >= words.length) {
            clearInterval(timer);
            resolve({text: DEMO_TRANSCRIPT});
            return;
          }
          options.onPartial?.(words.slice(0, index).join(' '));
        }, WORD_INTERVAL_MS);
        options.signal?.addEventListener('abort', () => {
          clearInterval(timer);
          reject(audioError('cancelled', 'Transcription cancelled'));
        });
      });
    },
  };
}
