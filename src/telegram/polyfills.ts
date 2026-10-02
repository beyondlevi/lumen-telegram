// GramJS expects Node's Buffer and process globals; install browser versions
// before it loads (this module is imported first by gramClient).
import {Buffer} from 'buffer';

if (!('Buffer' in globalThis)) {
  Object.defineProperty(globalThis, 'Buffer', {value: Buffer, writable: true, configurable: true});
}
if (!('process' in globalThis)) {
  Object.defineProperty(globalThis, 'process', {
    value: {env: {}, browser: true, versions: {}, nextTick: (callback: () => void) => queueMicrotask(callback)},
    writable: true,
    configurable: true,
  });
}
