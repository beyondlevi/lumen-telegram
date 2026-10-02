// Simulated `window.lumen.audio` for demo mode: an animated input level, a
// "recording" that is the packaged demo voice note, and a fixed English
// transcription delivered word by word. No microphone, no network, no storage.
import voiceNote from '../demo/assets/voice-note.ogg';
import {RECORD_LIMIT_MS, type LumenAudio, type LumenAudioError, type LumenAudioResult, type LumenRecording} from './lumenAudio';

// Timings like the glasses: the microphone starts in 0.5–2 s, the file arrives
// a few seconds after stop() and transcription takes about the audio's length.
const LEVEL_INTERVAL_MS = 200;
const START_DELAY_MS = 1000;
const FINISH_DELAY_MS = 2000;
const WORD_INTERVAL_MS = 250;

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

/** A speech-like level for time t (ms): 0.15–0.3 in phrases, 0 in the pauses between them, like the host. */
export function demoLevel(t: number): number {
  const phrase = Math.sin(t / 900 + 0.6);
  return phrase > -0.3 ? 0.15 + 0.15 * Math.abs(Math.sin(t / 130)) : 0;
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
      const result = async (durationMs: number): Promise<LumenAudioResult> => ({
        blob: await demoBlob(),
        mimeType: 'audio/ogg; codecs=opus',
        durationMs: Math.min(durationMs, maxMs),
      });
      const recording: LumenRecording = {
        onLevel: null,
        onEnd: null,
        async stop() {
          if (done) {
            throw audioError('cancelled', 'The recording already ended');
          }
          const durationMs = Date.now() - startedAt;
          finish();
          await new Promise(resolve => setTimeout(resolve, FINISH_DELAY_MS));
          return result(durationMs);
        },
        cancel() {
          finish();
        },
      };
      timer = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= maxMs) {
          finish();
          void result(elapsed).then(audio => recording.onEnd?.('max', audio));
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
