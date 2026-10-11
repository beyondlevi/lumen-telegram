import type {PageHandle} from '@wearables-ui-toolkit/mrbd';
import {useLayoutEffect, useState} from 'react';

/** Header height, measured once laid out and on resize; 0 until known. */
export function useHeaderHeight(pageRef: {current: PageHandle | null}): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const measure = () => setHeight(pageRef.current?.getHeaderHeight() ?? 0);
    measure();
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
    };
  }, [pageRef]);
  return height;
}
