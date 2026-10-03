// A scripted Web Speech API recognizer (SpeechRecognition and
// webkitSpeechRecognition), as the Lumen host's shim provides it, for the E2E
// tests. Inject with context.addInitScript(fakeSpeechScript()). Tests set what
// the next recognition hears through window.__speechControl.next and read the
// calls in window.__speechLog.
//
// __speechControl.next (used by the next start(), then cleared):
//   text       words heard, delivered one by one as interim results (250 ms apart)
//   waitForStop true: keep listening until stop() (the wearer taps Done); else a
//              pause ends it 400 ms after the last word
//   error      'no-speech' | 'not-allowed' | 'network' | …: fail with that error
// __speechLog: [{op: 'start', lang, interimResults, continuous} | {op: 'stop'} | {op: 'abort'}]
export function fakeSpeechScript() {
  return `
    (() => {
      const control = (window.__speechControl = {next: null, active: null});
      const log = (window.__speechLog = []);
      class FakeRecognition {
        constructor() {
          this.lang = '';
          this.continuous = false;
          this.interimResults = false;
          this.maxAlternatives = 1;
          this.onstart = this.onresult = this.onerror = this.onend = null;
          this._timers = [];
          this._heard = '';
          this._over = false;
        }
        start() {
          if (control.active) throw new DOMException('recognition has already started', 'InvalidStateError');
          control.active = this;
          log.push({op: 'start', lang: this.lang, interimResults: this.interimResults, continuous: this.continuous});
          const plan = control.next || {text: ''};
          control.next = null;
          this._plan = plan;
          this._later(50, () => this.onstart && this.onstart({type: 'start'}));
          if (plan.error) {
            this._later(300, () => {
              this.onerror && this.onerror({type: 'error', error: plan.error, message: ''});
              this._end();
            });
            return;
          }
          const words = plan.text ? plan.text.split(' ') : [];
          words.forEach((word, index) => this._later(300 + index * 250, () => this._emit(words.slice(0, index + 1).join(' '), false)));
          if (!plan.waitForStop) this._later(300 + words.length * 250 + 400, () => this._finish());
        }
        stop() {
          if (this._over) return;
          log.push({op: 'stop'});
          this._finish();
        }
        abort() {
          if (this._over) return;
          log.push({op: 'abort'});
          this._clear();
          this._over = true;
          setTimeout(() => {
            this.onerror && this.onerror({type: 'error', error: 'aborted', message: ''});
            this._end();
          }, 10);
        }
        _finish() {
          if (this._over) return;
          this._over = true;
          this._clear();
          setTimeout(() => {
            if (this._heard) this._emit(this._heard, true);
            else this.onerror && this.onerror({type: 'error', error: 'no-speech', message: ''});
            this._end();
          }, 100);
        }
        _emit(text, isFinal) {
          this._heard = text;
          const result = [{transcript: text, confidence: isFinal ? 0.9 : 0}];
          result.isFinal = isFinal;
          this.onresult && this.onresult({type: 'result', results: [result], resultIndex: 0});
        }
        _later(ms, fn) {
          this._timers.push(setTimeout(fn, ms));
        }
        _clear() {
          this._timers.forEach(clearTimeout);
          this._timers = [];
        }
        _end() {
          if (this._ended) return;
          this._ended = true;
          control.active = null;
          this.onend && this.onend({type: 'end'});
        }
      }
      window.SpeechRecognition = FakeRecognition;
      window.webkitSpeechRecognition = FakeRecognition;
    })();`;
}

/** Removes the browser's own recognizer, so a page has only what a test injects. */
export const NO_NATIVE_SPEECH = `
  (() => {
    try { delete window.SpeechRecognition; } catch {}
    try { delete window.webkitSpeechRecognition; } catch {}
    window.SpeechRecognition = undefined;
    window.webkitSpeechRecognition = undefined;
  })();`;
