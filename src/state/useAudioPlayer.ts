import {useCallback, useEffect, useRef, useState} from 'react';
import type {ChatMessage} from '../telegram/model';
import type {LoadedMedia} from './media';

export type AudioStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export type AudioState = {
  /** Message the player belongs to; null before the first play. */
  id: string | null;
  status: AudioStatus;
  /** Seconds. */
  position: number;
  /** Seconds; from the media once known, otherwise from the message. */
  duration: number;
};

const IDLE: AudioState = {id: null, status: 'idle', position: 0, duration: 0};

/**
 * One voice message plays at a time. The media is downloaded on the first
 * play (OGG/Opus plays in GeckoView and Chromium through <audio>), and the
 * player stops when the conversation closes.
 */
export function useAudioPlayer(
  loadMedia: (message: ChatMessage) => Promise<LoadedMedia>,
  onError: (error: unknown) => void,
): [AudioState, (message: ChatMessage) => void] {
  const [state, setState] = useState<AudioState>(IDLE);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const audio = useCallback(() => {
    if (audioRef.current == null) {
      const element = new Audio();
      element.preload = 'auto';
      const update = (patch: Partial<AudioState>) => setState(current => ({...current, ...patch}));
      element.addEventListener('timeupdate', () => update({position: element.currentTime}));
      element.addEventListener('durationchange', () => {
        if (Number.isFinite(element.duration) && element.duration > 0) {
          update({duration: element.duration});
        }
      });
      element.addEventListener('playing', () => update({status: 'playing'}));
      element.addEventListener('pause', () => {
        if (!element.ended) {
          // Only a playing message pauses; a pause while switching keeps the new one loading.
          setState(current => (current.status === 'playing' ? {...current, status: 'paused'} : current));
        }
      });
      element.addEventListener('ended', () => update({status: 'idle', position: 0}));
      element.addEventListener('error', () => {
        if (element.getAttribute('src')) {
          update({status: 'error'});
          onErrorRef.current(new Error('decode'));
        }
      });
      audioRef.current = element;
    }
    return audioRef.current;
  }, []);

  useEffect(
    () => () => {
      const element = audioRef.current;
      if (element) {
        element.pause();
        element.removeAttribute('src');
        element.load();
      }
    },
    [],
  );

  const toggle = useCallback(
    (message: ChatMessage) => {
      const element = audio();
      const current = stateRef.current;
      if (current.id === message.id) {
        if (current.status === 'loading') {
          return;
        }
        if (current.status === 'playing') {
          element.pause();
          return;
        }
        if (current.status === 'paused' || (current.status === 'idle' && element.getAttribute('src'))) {
          element.play().catch(() => setState(state => ({...state, status: 'paused'})));
          return;
        }
      }
      element.pause();
      const seconds = message.content.seconds ?? 0;
      setState({id: message.id, status: 'loading', position: 0, duration: seconds});
      loadMedia(message).then(
        media => {
          if (stateRef.current.id !== message.id) {
            return;
          }
          element.src = media.src;
          element.currentTime = 0;
          // Without a fresh key press the engine may refuse to start; Enter then resumes.
          element.play().catch(() => setState(state => ({...state, status: 'paused'})));
        },
        error => {
          if (stateRef.current.id !== message.id) {
            return;
          }
          setState(state => ({...state, status: 'error'}));
          onErrorRef.current(error);
        },
      );
    },
    [audio, loadMedia],
  );

  return [state, toggle];
}
