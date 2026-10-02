import {useCallback, useEffect, useRef, useState} from 'react';
import {
  getConfigSource,
  parseConfig,
  sameConfig,
  type ConfigState,
  type ConfigValues,
} from '../config/lumenConfig';

/**
 * Reads the Telegram settings from `window.lumen.config` (or the development
 * fallback) and follows changes made on the phone while the app is open.
 */
export function useLumenConfig(): [ConfigState, () => Promise<ConfigState>] {
  const [config, setConfig] = useState<ConfigState>({status: 'loading'});
  const reloadRef = useRef<() => Promise<ConfigState>>(() => Promise.resolve(config));

  useEffect(() => {
    const source = getConfigSource();
    let alive = true;
    const apply = (values: ConfigValues) => {
      if (!alive) {
        return;
      }
      const next = parseConfig(values);
      setConfig(previous => (sameConfig(previous, next) ? previous : next));
    };
    const read = () =>
      source.get().then(
        values => {
          apply(values);
          return parseConfig(values);
        },
        () => {
          apply({});
          return parseConfig({});
        },
      );
    reloadRef.current = read;
    void read();
    const unsubscribe = source.subscribe(values => (values ? apply(values) : void read()));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const reload = useCallback(() => reloadRef.current(), []);
  return [config, reload];
}
