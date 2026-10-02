import {afterEach, describe, expect, it, vi} from 'vitest';
import {audioErrorMessage} from '../../src/audio/audioErrors';
import {createDemoAudio, DEMO_TRANSCRIPT, demoLevel} from '../../src/audio/demoAudio';
import {audioErrorCode, hostAudio, meterLevel, RECORD_LIMIT_MS} from '../../src/audio/lumenAudio';

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

  it('scales speech levels (0.15–0.3) up for the meter', () => {
    expect(meterLevel(0)).toBe(0);
    expect(meterLevel(0.15)).toBeCloseTo(0.45);
    expect(meterLevel(0.3)).toBeCloseTo(0.9);
    expect(meterLevel(0.5)).toBe(1);
    expect(meterLevel(-1)).toBe(0);
  });
});

describe('demo audio', () => {
  it('reports levels and stops with the packaged voice note', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([79, 103, 103, 83]))));
    const audio = createDemoAudio();
    let started = false;
    const starting = audio.record().then(recording => ((started = true), recording));
    await vi.advanceTimersByTimeAsync(500);
    expect(started).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    const recording = await starting;
    const levels: number[] = [];
    recording.onLevel = level => levels.push(level);
    await vi.advanceTimersByTimeAsync(2000);
    expect(levels.length).toBeGreaterThanOrEqual(8);
    expect(levels.every(level => level === 0 || (level >= 0.15 && level <= 0.3))).toBe(true);
    expect(levels.some(level => level > 0)).toBe(true);
    await expect(audio.record()).rejects.toMatchObject({code: 'busy'});
    let finished = false;
    const stopping = recording.stop().then(result => ((finished = true), result));
    await vi.advanceTimersByTimeAsync(1500);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    const result = await stopping;
    expect(result.mimeType).toBe('audio/ogg; codecs=opus');
    expect(result.durationMs).toBeGreaterThanOrEqual(2000);
    expect(result.durationMs).toBeLessThan(2500);
    expect(result.blob.size).toBe(4);
  });

  it('ends by itself at the limit with the audio', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]))));
    const recording = await (async () => {
      const pending = createDemoAudio().record({maxMs: 1000});
      await vi.advanceTimersByTimeAsync(1100);
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
    let transcribed = false;
    const done = audio.transcribe(new Blob(['x']), {onPartial: text => partials.push(text)}).then(result => ((transcribed = true), result));
    // About as long as the 6 s demo voice note, like the host.
    await vi.advanceTimersByTimeAsync(4500);
    expect(transcribed).toBe(false);
    await vi.advanceTimersByTimeAsync(5500);
    expect(await done).toEqual({text: DEMO_TRANSCRIPT});
    expect(partials.length).toBe(DEMO_TRANSCRIPT.split(' ').length - 1);
    expect(DEMO_TRANSCRIPT.startsWith(partials[0])).toBe(true);
    const controller = new AbortController();
    const cancelled = audio.transcribe(new Blob(['x']), {signal: controller.signal});
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({code: 'cancelled'});
    expect(demoLevel(0)).toBeGreaterThan(0);
  });
});
