// A scripted `window.lumen.audio` (the Lumen host's microphone and dictation
// API) for the E2E tests. Inject with context.addInitScript(fakeAudioScript(url))
// after the window.lumen config script; tests steer it through
// window.__audioControl and read what happened in window.__audioLog.
//
// __audioControl:
//   recordError   'busy' | 'no-phone' | … : the next record() rejects with that code
//   endAfterMs    number: the recording ends by itself ('max') after that time
//   transcribeError 'engine' | 'no-speech' | … : the next transcribe() rejects
//   transcript    text returned by transcribe(), delivered word by word as partials
// __audioLog: {records: [options], stops, cancels, transcribes, partials}

/** `voiceUrl` is an OGG/Opus file the fake returns as the recording. */
export function fakeAudioScript(voiceUrl) {
  return `
    (() => {
      const voiceUrl = ${JSON.stringify(voiceUrl)};
      const control = (window.__audioControl = {recordError: null, endAfterMs: null, transcribeError: null,
        transcript: 'This is a fake transcript of the voice message.'});
      const log = (window.__audioLog = {records: [], stops: 0, cancels: 0, transcribes: 0, partials: 0});
      const failure = (code, message) => Object.assign(new Error(message || code), {code});
      const recordingBlob = async () => new Blob([await (await fetch(voiceUrl)).arrayBuffer()], {type: 'audio/ogg'});
      window.lumen = window.lumen || {};
      window.lumen.audio = {
        async record(options = {}) {
          log.records.push(options);
          if (control.recordError) {
            const code = control.recordError;
            control.recordError = null;
            throw failure(code, code === 'engine' ? 'Recorder crashed' : '');
          }
          const started = Date.now();
          let done = false;
          const result = async () => ({blob: await recordingBlob(), mimeType: 'audio/ogg; codecs=opus', durationMs: Date.now() - started});
          const recording = {
            onLevel: null,
            onEnd: null,
            async stop() {
              log.stops += 1;
              done = true;
              clearInterval(timer);
              return result();
            },
            cancel() {
              log.cancels += 1;
              done = true;
              clearInterval(timer);
            },
          };
          const timer = setInterval(() => {
            if (done) return;
            const elapsed = Date.now() - started;
            if (control.endAfterMs != null && elapsed >= control.endAfterMs) {
              done = true;
              clearInterval(timer);
              result().then(audio => recording.onEnd && recording.onEnd('max', audio));
              return;
            }
            recording.onLevel && recording.onLevel(0.2 + 0.6 * Math.abs(Math.sin(elapsed / 300)), elapsed);
          }, 200);
          return recording;
        },
        transcribe(audio, options = {}) {
          log.transcribes += 1;
          return new Promise((resolve, reject) => {
            if (!(audio instanceof Blob) || audio.size === 0) return reject(failure('unsupported-format'));
            if (control.transcribeError) {
              const code = control.transcribeError;
              control.transcribeError = null;
              return setTimeout(() => reject(failure(code, code === 'engine' ? 'Model not downloaded' : '')), 300);
            }
            const words = control.transcript.split(' ');
            let index = 0;
            const timer = setInterval(() => {
              index += 1;
              if (index >= words.length) {
                clearInterval(timer);
                return resolve({text: control.transcript});
              }
              log.partials += 1;
              options.onPartial && options.onPartial(words.slice(0, index).join(' '));
            }, 100);
            options.signal && options.signal.addEventListener('abort', () => {
              clearInterval(timer);
              reject(failure('cancelled'));
            });
          });
        },
      };
    })();`;
}
