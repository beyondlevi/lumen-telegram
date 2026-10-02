import trashFilled from '@wearables-ui-toolkit/icons/svg/trash__filled.svg';
import {
  Button,
  ButtonRail,
  IndeterminateLoader,
  IndeterminateLoaderSize,
  Page,
  ProgressIndicator,
  ProgressIndicatorSize,
  ScrollView,
  TextColor,
  TextStyle,
  TextView,
  Toast,
  type ButtonHandle,
} from '@wearables-ui-toolkit/mrbd';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Navigate, useNavigate, useParams} from 'react-router-dom';
import {audioErrorMessage} from '../audio/audioErrors';
import {meterLevel, RECORD_LIMIT_MS, type LumenRecording, type LumenAudioResult} from '../audio/lumenAudio';
import {failureReason} from '../failure';
import {formatDuration} from '../format';
import {t} from '../i18n/strings';
import {useChat} from '../ChatProvider';
import {StatusPage} from './StatusPage';

export function recordPath(chatId: string): string {
  return `/chat/${encodeURIComponent(chatId)}/record`;
}

type RecordState =
  | {kind: 'starting'}
  | {kind: 'recording'; elapsedMs: number; level: number}
  | {kind: 'limit'; result: LumenAudioResult}
  | {kind: 'finishing'; elapsedMs: number}
  | {kind: 'sending'; elapsedMs: number}
  | {kind: 'error'; message: string};

/** Records a voice note with the glasses' microphone (through the Lumen host) and sends it. */
export function RecordPage() {
  const {chatId} = useParams();
  const {phase, audio} = useChat();
  if (!chatId) {
    return <Navigate to="/" replace />;
  }
  if (phase.kind !== 'ready') {
    return <StatusPage phase={phase} />;
  }
  if (audio == null) {
    return <Navigate to={`/chat/${encodeURIComponent(chatId)}`} replace />;
  }
  return <Recorder chatId={chatId} />;
}

function Recorder({chatId}: {chatId: string}) {
  const {audio, sendVoice} = useChat();
  const navigate = useNavigate();
  const [state, setState] = useState<RecordState>({kind: 'starting'});
  const [attempt, setAttempt] = useState(0);
  const recordingRef = useRef<Promise<LumenRecording> | null>(null);
  const resultRef = useRef<LumenAudioResult | null>(null);
  const finishedRef = useRef(false);
  /** False once Back or Discard left the screen: a stop still finishing must not send. */
  const mountedRef = useRef(true);
  /** Input levels of this recording (about 5 per second), for the voice note's waveform. */
  const levelsRef = useRef<number[]>([]);
  const sendButtonRef = useRef<ButtonHandle>(null);

  // Send has the initial focus on every opening (the route would otherwise
  // restore the focus of a previous visit, e.g. Discard).
  useEffect(() => {
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => sendButtonRef.current?.getElement()?.focus({preventScroll: true}));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (audio == null) {
      return;
    }
    let alive = true;
    mountedRef.current = true;
    finishedRef.current = false;
    resultRef.current = null;
    levelsRef.current = [];
    setState({kind: 'starting'});
    const started = audio.record({maxMs: RECORD_LIMIT_MS});
    recordingRef.current = started;
    started.then(
      recording => {
        if (!alive) {
          recording.cancel();
          return;
        }
        recording.onLevel = (level, elapsedMs) => {
          levelsRef.current.push(level);
          setState(current => (current.kind === 'recording' || current.kind === 'starting' ? {kind: 'recording', elapsedMs, level} : current));
        };
        recording.onEnd = (reason, result, error) => {
          if (!alive) {
            return;
          }
          if (reason === 'max' && result) {
            resultRef.current = result;
            setState(current => (current.kind === 'sending' || current.kind === 'finishing' ? current : {kind: 'limit', result}));
          } else {
            setState({kind: 'error', message: audioErrorMessage(error ?? new Error('error'))});
          }
        };
        setState(current => (current.kind === 'starting' ? {kind: 'recording', elapsedMs: 0, level: 0} : current));
      },
      error => {
        if (alive) {
          setState({kind: 'error', message: audioErrorMessage(error)});
        }
      },
    );
    return () => {
      alive = false;
      mountedRef.current = false;
      // Back or Discard: drop the recording unless it was sent.
      if (!finishedRef.current) {
        void started.then(recording => recording.cancel(), () => undefined);
      }
    };
  }, [attempt, audio]);

  const send = useCallback(async () => {
    if (state.kind !== 'recording' && state.kind !== 'limit') {
      return;
    }
    const elapsedMs = state.kind === 'recording' ? state.elapsedMs : state.result.durationMs;
    try {
      let result = resultRef.current;
      if (result == null) {
        // The host encodes the audio and brings it over from the phone: a few seconds.
        setState({kind: 'finishing', elapsedMs});
        const recording = await recordingRef.current;
        if (recording == null) {
          return;
        }
        result = await recording.stop();
        if (!mountedRef.current) {
          return;
        }
        resultRef.current = result;
      }
      setState({kind: 'sending', elapsedMs: result.durationMs});
      finishedRef.current = true;
      await sendVoice(chatId, result, levelsRef.current);
      Toast.show(t('voiceSent'));
      navigate(-1);
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      if (resultRef.current == null) {
        // Stopping failed: the recording is lost.
        finishedRef.current = false;
        setState({kind: 'error', message: audioErrorMessage(error)});
        return;
      }
      // Sending failed: keep the audio so Send can try again.
      Toast.show(t('voiceFailed', {reason: failureReason(error)}));
      setState({kind: 'limit', result: resultRef.current});
    }
  }, [chatId, navigate, sendVoice, state]);

  const discard = useCallback(() => navigate(-1), [navigate]);
  const retry = useCallback(() => setAttempt(count => count + 1), []);

  const elapsedMs =
    state.kind === 'recording' || state.kind === 'finishing' || state.kind === 'sending'
      ? state.elapsedMs
      : state.kind === 'limit'
        ? state.result.durationMs
        : 0;
  const status =
    state.kind === 'starting'
      ? t('recordingStarting')
      : state.kind === 'recording'
        ? t('recordingNow')
        : state.kind === 'limit'
          ? t('recordingLimit', {limit: formatDuration(RECORD_LIMIT_MS / 1000)})
          : state.kind === 'finishing'
            ? t('recordingFinishing')
            : state.kind === 'sending'
              ? t('recordingSending')
              : state.message;
  const waiting = state.kind === 'starting' || state.kind === 'finishing' || state.kind === 'sending';
  // Send is disabled while the audio arrives. While the microphone starts it stays
  // enabled (and does nothing), because a disabled Button cannot take the initial focus.
  const sendDisabled = state.kind === 'finishing' || state.kind === 'sending';

  return (
    <Page headerText={t('recordingHeader')} enableSystemBarInset={false}>
      <div className="action-page-shell">
        <ScrollView insetForHeader ariaLabel={t('recordingLabel')}>
          <div className="content-inset record-panel" role="status">
            {state.kind === 'error' ? (
              <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
                {t('recordingFailedTitle')}
              </TextView>
            ) : (
              <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
                {formatDuration(elapsedMs / 1000)}
              </TextView>
            )}
            {state.kind === 'recording' ? (
              <ProgressIndicator
                size={ProgressIndicatorSize.DEFAULT}
                value={meterLevel(state.level)}
                maximumValue={1}
                isActive
                announceUpdatesForAccessibility={false}
                aria-label={t('recordingLevel')}
              />
            ) : null}
            {waiting ? (
              <IndeterminateLoader size={IndeterminateLoaderSize.SMALL} />
            ) : null}
            <TextView as="p" textStyle={state.kind === 'error' ? TextStyle.BODY2 : TextStyle.META1} textColor={state.kind === 'error' ? undefined : TextColor.SECONDARY}>
              {status}
            </TextView>
          </div>
        </ScrollView>
        <div className="action-dock">
          <ButtonRail>
            {/* One Button whose command follows the state, so focus stays put. */}
            <Button
              ref={sendButtonRef}
              title={state.kind === 'error' ? t('retry') : t('sendVoiceAction')}
              onClick={state.kind === 'error' ? retry : send}
              disabled={sendDisabled}
            />
            <Button title={t('discardAction')} icon={trashFilled} onClick={discard} />
          </ButtonRail>
        </div>
      </div>
    </Page>
  );
}
