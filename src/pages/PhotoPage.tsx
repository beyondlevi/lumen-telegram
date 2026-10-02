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
import {failureReason} from '../failure';
import {chatDisplayName} from '../format';
import {t} from '../i18n/strings';
import {useChat} from '../ChatProvider';
import {StatusPage} from './StatusPage';

type PhotoState = {status: 'loading'} | {status: 'ready'; src: string} | {status: 'error'; reason: string};

/** A photo message in full screen, downloaded when opened. */
export function PhotoPage() {
  const {chatId, messageId} = useParams();
  const {phase} = useChat();
  if (!chatId || !messageId) {
    return <Navigate to="/" replace />;
  }
  if (phase.kind !== 'ready') {
    return <StatusPage phase={phase} />;
  }
  return <Photo chatId={chatId} messageId={messageId} />;
}

function Photo({chatId, messageId}: {chatId: string; messageId: string}) {
  const {thread, chatFor, loadMedia} = useChat();
  const message = thread(chatId).messages.find(candidate => candidate.id === messageId);
  const sender = message?.fromMe ? t('you') : message?.senderName ?? chatDisplayName(chatFor(chatId));
  const label = t('photoLabel', {name: sender});
  const caption = message?.content.text ?? '';
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PhotoState>({status: 'loading'});

  useEffect(() => {
    if (message == null) {
      return;
    }
    let alive = true;
    setState({status: 'loading'});
    loadMedia(message).then(
      media => alive && setState({status: 'ready', src: media.src}),
      error => alive && setState({status: 'error', reason: failureReason(error)}),
    );
    return () => {
      alive = false;
    };
    // Reload only for another message or Try again; thread polling must not restart the download.
  }, [attempt, loadMedia, message?.id]);

  const retry = useCallback(() => setAttempt(count => count + 1), []);

  if (message == null) {
    // Opened without the conversation loaded (e.g. a reload): go to the conversation.
    return <Navigate to={`/chat/${encodeURIComponent(chatId)}`} replace />;
  }

  if (state.status === 'error') {
    return (
      <Page headerText={t('photoHeader')} enableSystemBarInset={false}>
        <div className="action-page-shell">
          <ScrollView insetForHeader tabIndex={0} ariaLabel={t('photoFailedTitle')}>
            <div className="content-inset" role="alert">
              <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
                {t('photoFailedTitle')}
              </TextView>
              <TextView as="p" textStyle={TextStyle.BODY2}>
                {t('photoFailedBody', {reason: state.reason})}
              </TextView>
            </div>
          </ScrollView>
          <div className="action-dock">
            <ButtonRail>
              <Button title={t('retry')} onClick={retry} />
            </ButtonRail>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page showHeader={false} enableSystemBarInset={false}>
      <ScrollView tabIndex={0} ariaLabel={state.status === 'ready' ? label : t('photoLoading')}>
        <div className="content-inset photo-frame" role={state.status === 'ready' ? undefined : 'status'}>
          {state.status === 'ready' ? (
            <img className="photo-image" src={state.src} alt={caption ? `${label}: ${caption}` : label} />
          ) : (
            <>
              <IndeterminateLoader size={IndeterminateLoaderSize.MEDIUM} />
              <TextView as="p" textStyle={TextStyle.META1} textColor={TextColor.SECONDARY}>
                {t('photoLoading')}
              </TextView>
            </>
          )}
        </div>
      </ScrollView>
    </Page>
  );
}
