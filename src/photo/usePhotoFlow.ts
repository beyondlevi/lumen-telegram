import {Toast, type ButtonHandle} from '@wearables-ui-toolkit/mrbd';
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {NavigateFunction} from 'react-router-dom';
import {t} from '../i18n/strings';
import {whenIdle} from '../state/whenIdle';
import {readPhoto, type CapturedPhoto} from './capturedPhoto';
import type {PhotoInputHandle} from './PhotoInput';
import {isPhotoSendState} from './sendState';

/**
 * Taking and sending a photo from a conversation. Photo opens the camera; the
 * photo taken opens the send screen as a history entry of the conversation's
 * own page (Back closes it, like the reply field), so the conversation stays
 * mounted under it and comes back at once. Send goes back first and hands the
 * photo over once the conversation is shown again, so its bubble appears there.
 */
export function usePhotoFlow({
  jid,
  pathname,
  state,
  navigate,
  sendPhoto,
}: {
  jid: string;
  pathname: string;
  state: unknown;
  navigate: NavigateFunction;
  sendPhoto: (jid: string, photo: CapturedPhoto, caption: string) => void;
}) {
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  // One per opening of the send screen (Retake keeps it, and the caption).
  const [session, setSession] = useState(0);
  const open = photo != null && isPhotoSendState(state);
  const inputRef = useRef<PhotoInputHandle>(null);
  const photoButtonRef = useRef<ButtonHandle>(null);
  const focusParkRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const toSend = useRef<{photo: CapturedPhoto; caption: string} | null>(null);
  const returning = useRef(false);

  const take = useCallback(() => inputRef.current?.open(), []);

  const photoTaken = useCallback(
    (file: File) => {
      readPhoto(file).then(
        next => {
          setPhoto(previous => {
            if (previous != null) {
              URL.revokeObjectURL(previous.url);
            }
            return next;
          });
          if (!openRef.current) {
            setSession(count => count + 1);
            navigate(pathname, {state: {photoSend: true}});
          }
        },
        () => Toast.show(t('photoReadFailed')),
      );
    },
    [navigate, pathname],
  );

  const send = useCallback(
    (caption: string) => {
      if (photo == null) {
        return;
      }
      toSend.current = {photo, caption};
      returning.current = true;
      navigate(-1);
    },
    [navigate, photo],
  );

  const cancel = useCallback(() => {
    returning.current = true;
    navigate(-1);
  }, [navigate]);

  // Closing, the focus waits on a neutral element (not a focus target) until
  // the conversation takes it back: left on the screen that goes, it would be
  // given to some control at once, and drawn, in the frame that shows the
  // conversation.
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    const focused = document.activeElement;
    if (!open && wasOpen.current && (focused === document.body || focused?.closest('.photo-send-layer') != null)) {
      focusParkRef.current?.focus({preventScroll: true});
    }
  }, [open]);

  // Closed (Back, Cancel or Send): the screen goes under the conversation at
  // once and is dropped in idle time, with its preview; a photo being sent keeps its blob.
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (closed) {
      returning.current = true;
    }
    if (open || photo == null) {
      return;
    }
    return whenIdle(() => {
      URL.revokeObjectURL(photo.url);
      setPhoto(null);
    }, 1000);
  }, [open, photo]);

  /** The conversation can take the focus again: send the photo, and the focus goes back to Photo. */
  const conversationLive = useCallback(() => {
    const pending = toSend.current;
    toSend.current = null;
    if (pending != null) {
      sendPhoto(jid, pending.photo, pending.caption);
    }
    if (returning.current) {
      returning.current = false;
      photoButtonRef.current?.getElement()?.focus({preventScroll: true});
    }
  }, [jid, sendPhoto]);

  return {photo, open, session, inputRef, photoButtonRef, focusParkRef, take, retake: take, photoTaken, send, cancel, conversationLive};
}
