import {
  Button,
  ButtonRail,
  IndeterminateLoader,
  IndeterminateLoaderSize,
  Page,
  ScrollView,
  TextColor,
  TextStyle,
  TextView,
} from '@wearables-ui-toolkit/mrbd';
import {useCallback, useEffect, useState} from 'react';
import {Navigate, useParams} from 'react-router-dom';
import {audioErrorMessage} from '../audio/audioErrors';
import {audioErrorCode} from '../audio/lumenAudio';
import {failureReason} from '../failure';
import {chatDisplayName, formatDuration} from '../format';
import {t} from '../i18n/strings';
import {useChat} from '../ChatProvider';
import {StatusPage} from './StatusPage';

export function transcriptPath(chatId: string, messageId: string): string {
  return `/chat/${encodeURIComponent(chatId)}/transcript/${encodeURIComponent(messageId)}`;
}

type TranscriptState =
  | {status: 'working'; partial: string}
  | {status: 'done'; text: string}
  | {status: 'error'; message: string};

/** Transcript of a voice message, made by the Lumen host's dictation engine. */
export function TranscriptPage() {
  const {chatId, messageId} = useParams();
  const {phase} = useChat();
  if (!chatId || !messageId) {
    return <Navigate to="/" replace />;
  }
  if (phase.kind !== 'ready') {
    return <StatusPage phase={phase} />;
  }
  return <Transcript chatId={chatId} messageId={messageId} />;
}

function Transcript({chatId, messageId}: {chatId: string; messageId: string}) {
  const {thread, chatFor, loadMedia, audio, transcriptFor, saveTranscript} = useChat();
  const message = thread(chatId).messages.find(candidate => candidate.id === messageId);
  const cached = transcriptFor(messageId);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<TranscriptState>(
    cached != null ? {status: 'done', text: cached} : {status: 'working', partial: ''},
  );

  useEffect(() => {
    if (message == null || audio == null || (attempt === 0 && cached != null)) {
      return;
    }
    const controller = new AbortController();
    setState({status: 'working', partial: ''});
    (async () => {
      let blob: Blob;
      try {
        const media = await loadMedia(message);
        blob = await (await fetch(media.src)).blob();
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({status: 'error', message: t('audioFailed', {reason: failureReason(error)})});
        }
        return;
      }
      try {
        const result = await audio.transcribe(blob, {
          signal: controller.signal,
          onPartial: partial => {
            if (!controller.signal.aborted) {
              setState({status: 'working', partial});
            }
          },
        });
        if (!controller.signal.aborted) {
          saveTranscript(messageId, result.text);
          setState({status: 'done', text: result.text});
        }
      } catch (error) {
        if (!controller.signal.aborted && audioErrorCode(error) !== 'cancelled') {
          setState({status: 'error', message: audioErrorMessage(error)});
        }
      }
    })();
    // Back stops the transcription.
    return () => controller.abort();
    // Run once per opening (and Try again); new polls of the thread must not restart it.
  }, [attempt, audio, message?.id]);

  const retry = useCallback(() => setAttempt(count => count + 1), []);

  if (message == null || audio == null) {
    return <Navigate to={`/chat/${encodeURIComponent(chatId)}`} replace />;
  }

  const sender = message.fromMe ? t('you') : message.senderName ?? chatDisplayName(chatFor(chatId));
  const meta = `${sender}, ${formatDuration(message.content.seconds ?? 0)}`.toUpperCase();
  const text =
    state.status === 'done' ? state.text || t('transcriptEmpty') : state.status === 'working' ? state.partial : state.message;

  return (
    <Page headerText={t('transcriptHeader')} enableSystemBarInset={false}>
      <div className="action-page-shell">
        <ScrollView insetForHeader tabIndex={0} ariaLabel={t('transcriptLabel', {name: sender})}>
          <div className="content-inset" role="status" aria-live="polite">
            <TextView as="p" textStyle={TextStyle.LABEL} textColor={TextColor.SECONDARY}>
              {meta}
            </TextView>
            {state.status === 'error' ? (
              <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
                {t('transcriptFailedTitle')}
              </TextView>
            ) : null}
            {text ? (
              <TextView as="p" textStyle={TextStyle.BODY2}>
                {text}
              </TextView>
            ) : null}
            {state.status === 'working' ? (
              <div className="transcript-progress">
                <IndeterminateLoader size={IndeterminateLoaderSize.SMALL} />
                <TextView as="p" textStyle={TextStyle.META1} textColor={TextColor.SECONDARY}>
                  {t('transcribing')}
                </TextView>
              </div>
            ) : null}
          </div>
        </ScrollView>
        {state.status === 'error' ? (
          <div className="action-dock">
            <ButtonRail>
              <Button title={t('retry')} onClick={retry} />
            </ButtonRail>
          </div>
        ) : null}
      </div>
    </Page>
  );
}
