import {afterEach, describe, expect, it, vi} from 'vitest';
import {audioErrorMessage} from '../../src/audio/audioErrors';
import {createDemoAudio, DEMO_TRANSCRIPT, demoLevel} from '../../src/audio/demoAudio';
import {audioErrorCode, hostAudio, RECORD_LIMIT_MS} from '../../src/audio/lumenAudio';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const failure = (code: string, message = '') => Object.assign(new Error(message), {code});

describe('host audio API', () => {
  it('is used only when the host has record and transcribe', () => {
    const audio = {record: async () => ({}), transcribe: async () => ({text: ''})};
    expect(hostAudio({lumen: {audio}})).toBe(audio);
    expect(hostAudio({lumen: {}})).toBeNull();
    expect(hostAudio({})).toBeNull();
    expect(hostAudio({lumen: {audio: {record: () => undefined}}})).toBeNull();
  });

  it('turns error codes into messages', () => {
    expect(audioErrorCode(failure('busy'))).toBe('busy');
    expect(audioErrorCode(new Error('x'))).toBe('');
    expect(audioErrorMessage(failure('busy'))).toMatch(/busy with another recording or dictation/);
    expect(audioErrorMessage(failure('no-phone'))).toMatch(/not connected to the phone/);
    expect(audioErrorMessage(failure('engine', 'Model missing'))).toBe('The transcription engine failed: Model missing');
    expect(audioErrorMessage(failure('no-speech'))).toMatch(/No speech/);
    expect(audioErrorMessage(new Error('odd'))).toBe('Something went wrong: odd');
  });
});

describe('demo audio', () => {
  it('reports levels and stops with the packaged voice note', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([79, 103, 103, 83]))));
    const audio = createDemoAudio();
    const starting = audio.record();
    await vi.advanceTimersByTimeAsync(400);
    const recording = await starting;
    const levels: number[] = [];
    recording.onLevel = level => levels.push(level);
    await vi.advanceTimersByTimeAsync(2000);
    expect(levels.length).toBeGreaterThanOrEqual(8);
    expect(levels.every(level => level >= 0 && level <= 1)).toBe(true);
    await expect(audio.record()).rejects.toMatchObject({code: 'busy'});
    const result = await recording.stop();
    expect(result.mimeType).toBe('audio/ogg; codecs=opus');
    expect(result.durationMs).toBeGreaterThanOrEqual(2000);
    expect(result.blob.size).toBe(4);
  });

  it('ends by itself at the limit with the audio', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]))));
    const recording = await (async () => {
      const pending = createDemoAudio().record({maxMs: 1000});
      await vi.advanceTimersByTimeAsync(400);
      return pending;
    })();
    const ended = new Promise(resolve => {
      recording.onEnd = (reason, result) => resolve({reason, durationMs: result?.durationMs});
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(await ended).toEqual({reason: 'max', durationMs: 1000});
    expect(RECORD_LIMIT_MS).toBe(120000);
  });

  it('transcribes with partials and can be cancelled', async () => {
    vi.useFakeTimers();
    const audio = createDemoAudio();
    const partials: string[] = [];
    const done = audio.transcribe(new Blob(['x']), {onPartial: text => partials.push(text)});
    await vi.advanceTimersByTimeAsync(10000);
    expect(await done).toEqual({text: DEMO_TRANSCRIPT});
    expect(partials.length).toBeGreaterThan(5);
    expect(DEMO_TRANSCRIPT.startsWith(partials[0])).toBe(true);
    const controller = new AbortController();
    const cancelled = audio.transcribe(new Blob(['x']), {signal: controller.signal});
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({code: 'cancelled'});
    expect(demoLevel(0)).toBeGreaterThan(0);
  });
});
