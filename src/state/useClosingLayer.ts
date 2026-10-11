import {useEffect, useState} from 'react';
import {whenIdle} from './whenIdle';

/**
 * A screen drawn over another one, that stays (closed, under it) after it
 * closes and is dropped in idle time: unmounting it in the frame that shows
 * the screen under it would delay that frame. `value` is what it shows while
 * open; null once closed.
 */
export function useClosingLayer<T>(value: T | null): {value: T | null; shown: boolean} {
  const [kept, setKept] = useState<T | null>(value);
  if (value != null && value !== kept) {
    setKept(value);
  }
  useEffect(() => {
    if (value != null || kept == null) {
      return;
    }
    return whenIdle(() => setKept(null), 1000);
  }, [kept, value]);
  return {value: value ?? kept, shown: value != null};
}
