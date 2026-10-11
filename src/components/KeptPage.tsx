import {useEffect, useRef, useState, type ReactNode, type Ref} from 'react';

/**
 * A page that stays mounted above the routes. Hidden, it goes under them
 * (they are drawn opaque over it) and takes no focus, keys, pointer or screen
 * reader; it keeps its rows, scroll and drawing, so showing it again only
 * brings it back on top. Shown again, it stays inert for one more frame:
 * lifting inert restyles every element in it, which would delay the frame
 * that shows it. `onLive` runs once it can take the focus again.
 */
export function KeptPage({
  shown,
  onLive,
  children,
  ref,
}: {
  shown: boolean;
  onLive?: () => void;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) {
  const [live, setLive] = useState(shown);
  useEffect(() => {
    if (!shown) {
      setLive(false);
      return;
    }
    let timer = 0;
    const frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => setLive(true));
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [shown]);
  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;
  useEffect(() => {
    if (shown && live) {
      onLiveRef.current?.();
    }
  }, [live, shown]);
  return (
    <div
      ref={ref}
      className={shown ? 'kept-page' : 'kept-page kept-page--hidden'}
      inert={!(shown && live)}
      aria-hidden={!shown}>
      {children}
    </div>
  );
}
