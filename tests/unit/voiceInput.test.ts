import {describe, expect, it, vi} from 'vitest';
import type {LumenAudio, LumenAudioResult, LumenRecording} from '../../src/audio/lumenAudio';
import {
  availableVoiceInputs,
  lumenAudioInput,
  pauseDetector,
  speechRecognitionInput,
  type SpeechRecognitionLike,
  type VoiceEvents,
} from '../../src/search/voiceInput';

function recorder() {
  const events: string[] = [];
  const handlers: VoiceEvents = {
    onPartial: text => events.push(`partial:${text}`),
    onLevel: () => undefined,
    onRecognizing: () => events.push('recognizing'),
    onResult: text => events.push(`result:${text}`),
    onError: code => events.push(`error:${code}`),
  };
  return {events, handlers};
}

class FakeRecognition implements SpeechRecognitionLike {
  static last: FakeRecognition | null = null;
  lang = '';
  continuous = true;
  interimResults = false;
  maxAlternatives = 3;
  onresult: SpeechRecognitionLike['onresult'] = null;
  onerror: SpeechRecognitionLike['onerror'] = null;
  onend: SpeechRecognitionLike['onend'] = null;
  calls: string[] = [];
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.calls.push('start');
  }
  stop() {
    this.calls.push('stop');
  }
  abort() {
    this.calls.push('abort');
  }
  hear(text: string, isFinal: boolean) {
    const result = Object.assign([{transcript: text}], {isFinal});
    this.onresult?.({results: [result]});
  }
}

describe('SpeechRecognition input', () => {
  it('asks for one interim-result phrase in the page language and reports partials and the final text', () => {
    const {events, handlers} = recorder();
    const listening = speechRecognitionInput(FakeRecognition).listen(handlers, 'pt-PT');
    const recognition = FakeRecognition.last!;
    expect(recognition.lang).toBe('pt-PT');
    expect(recognition.interimResults).toBe(true);
    expect(recognition.continuous).toBe(false);
    recognition.hear('Carla', false);
    recognition.hear('Carla Dias', false);
    listening.finish();
    expect(recognition.calls).toEqual(['start', 'stop']);
    recognition.hear('Carla Dias', true);
    recognition.onend?.();
    expect(events).toEqual(['partial:Carla', 'partial:Carla Dias', 'partial:Carla Dias', 'result:Carla Dias']);
  });

  it('keeps the last interim text when no final result comes', () => {
    const {events, handlers} = recorder();
    speechRecognitionInput(FakeRecognition).listen(handlers, 'en');
    FakeRecognition.last!.hear('Maia', false);
    FakeRecognition.last!.onend?.();
    expect(events.at(-1)).toBe('result:Maia');
  });

  it('maps errors: nothing said, no microphone, network', () => {
    for (const [error, expected] of [
      ['no-speech', 'error:no-speech'],
      ['not-allowed', 'error:unavailable'],
      ['audio-capture', 'error:unavailable'],
      ['network', 'error:network'],
      ['busy', 'error:busy'],
      ['something-else', 'error:failed'],
    ] as const) {
      const {events, handlers} = recorder();
      speechRecognitionInput(FakeRecognition).listen(handlers, 'en');
      FakeRecognition.last!.onerror?.({error});
      FakeRecognition.last!.onend?.();
      expect(events).toEqual([expected]);
    }
  });

  it('cancel aborts without any event', () => {
    const {events, handlers} = recorder();
    const listening = speechRecognitionInput(FakeRecognition).listen(handlers, 'en');
    listening.cancel();
    FakeRecognition.last!.onerror?.({error: 'aborted'});
    FakeRecognition.last!.onend?.();
    expect(FakeRecognition.last!.calls).toEqual(['start', 'abort']);
    expect(events).toEqual([]);
  });
});

describe('pause detector', () => {
  it('ends after a pause that follows speech, or when nothing is said', () => {
    const paused = vi.fn();
    const detect = pauseDetector(paused);
    detect(0.01, 200);
    detect(0.2, 400);
    detect(0.25, 800);
    detect(0.02, 1000);
    detect(0.02, 2000);
    expect(paused).not.toHaveBeenCalled();
    detect(0.02, 2200);
    expect(paused).toHaveBeenCalledTimes(1);

    const silent = vi.fn();
    const quiet = pauseDetector(silent);
    quiet(0.01, 5800);
    expect(silent).not.toHaveBeenCalled();
    quiet(0.01, 6000);
    expect(silent).toHaveBeenCalled();
  });
});

function fakeAudio(transcript: string, {recordError}: {recordError?: string} = {}) {
  const log = {stops: 0, cancels: 0, transcribed: [] as string[], language: ''};
  let current: LumenRecording | null = null;
  const result: LumenAudioResult = {blob: new Blob([new Uint8Array([1, 2, 3])]), mimeType: 'audio/ogg', durationMs: 1500};
  const audio: LumenAudio = {
    async record() {
      if (recordError) {
        throw Object.assign(new Error(recordError), {code: recordError});
      }
      current = {
        onLevel: null,
        onEnd: null,
        async stop() {
          log.stops += 1;
          return result;
        },
        cancel() {
          log.cancels += 1;
        },
      };
      return current;
    },
    async transcribe(_blob, options) {
      log.language = options?.language ?? '';
      options?.onPartial?.(transcript.split(' ')[0]);
      log.transcribed.push(transcript);
      return {text: transcript};
    },
  };
  return {audio, log, recording: () => current};
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('window.lumen.audio input', () => {
  it('records until a pause, then transcribes in the page language', async () => {
    const {events, handlers} = recorder();
    const {audio, log, recording} = fakeAudio('Ana Souza');
    lumenAudioInput(audio).listen(handlers, 'pt-PT');
    await flush();
    const level = recording()!.onLevel!;
    level(0.2, 200);
    level(0.2, 600);
    level(0.01, 800);
    level(0.01, 2100);
    await flush();
    await flush();
    expect(log.stops).toBe(1);
    expect(log.language).toBe('pt-PT');
    expect(events).toEqual(['recognizing', 'partial:Ana', 'result:Ana Souza']);
  });

  it('finish stops at once; the recording limit also ends it', async () => {
    const {events, handlers} = recorder();
    const {audio, log} = fakeAudio('Diego');
    const listening = lumenAudioInput(audio).listen(handlers, 'en');
    await flush();
    listening.finish();
    listening.finish();
    await flush();
    await flush();
    expect(log.stops).toBe(1);
    expect(events.at(-1)).toBe('result:Diego');
  });

  it('reports a busy microphone and an empty transcript', async () => {
    const busy = recorder();
    lumenAudioInput(fakeAudio('x', {recordError: 'busy'}).audio).listen(busy.handlers, 'en');
    await flush();
    expect(busy.events).toEqual(['error:busy']);

    const empty = recorder();
    const listening = lumenAudioInput(fakeAudio('  ').audio).listen(empty.handlers, 'en');
    await flush();
    listening.finish();
    await flush();
    await flush();
    expect(empty.events.at(-1)).toBe('error:no-speech');
  });

  it('cancel drops the recording without events', async () => {
    const {events, handlers} = recorder();
    const {audio, log} = fakeAudio('Ana');
    const listening = lumenAudioInput(audio).listen(handlers, 'en');
    await flush();
    listening.cancel();
    await flush();
    expect(log.cancels).toBeGreaterThanOrEqual(1);
    expect(log.stops).toBe(0);
    expect(events).toEqual([]);
  });
});

describe('available inputs', () => {
  const audio = fakeAudio('x').audio;
  it('prefers SpeechRecognition, then window.lumen.audio; none without either', () => {
    expect(availableVoiceInputs({webkitSpeechRecognition: FakeRecognition, lumen: {audio}}).map(input => input.kind)).toEqual([
      'speech-recognition',
      'lumen-audio',
    ]);
    expect(availableVoiceInputs({lumen: {audio}}).map(input => input.kind)).toEqual(['lumen-audio']);
    expect(availableVoiceInputs({SpeechRecognition: FakeRecognition}).map(input => input.kind)).toEqual(['speech-recognition']);
    expect(availableVoiceInputs({})).toEqual([]);
    expect(availableVoiceInputs({lumen: {}})).toEqual([]);
  });
});
