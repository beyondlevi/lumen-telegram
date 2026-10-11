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
  type ButtonHandle,
} from '@wearables-ui-toolkit/mrbd';
import {useCallback, useEffect, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {failureReason} from '../failure';
import {chatDisplayName} from '../format';
import {t} from '../i18n/strings';
import type {LoadedPhoto} from '../state/media';
import {useChat} from '../ChatProvider';

type PhotoState = {status: 'loading'} | {status: 'ready'; photo: LoadedPhoto} | {status: 'error'; reason: string};

/**
 * A photo of the conversation in full, drawn over it: the conversation stays
 * mounted under it, so Back (the middle tap) brings it back at once, with the
 * focus on the photo's bubble. The photo is downloaded when it opens (in
 * Telegram's size that covers the screen, 800 px), decoded at most 600 px,
 * and released when it closes. Closed, it stays under the conversation until
 * it is dropped.
 */
export function PhotoView({chatId, messageId, shown}: {chatId: string; messageId: string; shown: boolean}) {
  const {thread, chatFor, loadPhoto} = useChat();
  const navigate = useNavigate();
  const {loaded, messages} = thread(chatId);
  const message = messages.find(candidate => candidate.id === messageId);
  const sender = message?.fromMe ? t('you') : message?.senderName ?? chatDisplayName(chatFor(chatId));
  const label = t('photoLabel', {name: sender});
  const caption = message?.content.text ?? '';
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PhotoState>({status: 'loading'});
  const frameRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<ButtonHandle>(null);

  useEffect(() => {
    if (message == null) {
      return;
    }
    let alive = true;
    let shown: LoadedPhoto | null = null;
    setState({status: 'loading'});
    loadPhoto(message).then(
      photo => {
        if (alive) {
          shown = photo;
          setState({status: 'ready', photo});
        } else {
          photo.release();
        }
      },
      error => alive && setState({status: 'error', reason: failureReason(error)}),
    );
    return () => {
      alive = false;
      shown?.release();
    };
    // Reload only for another message or Try again; thread polling must not restart the download.
  }, [attempt, loadPhoto, message?.id]);

  // Opened without the message (a reload before the conversation came back): back to the conversation.
  useEffect(() => {
    if (shown && loaded && message == null) {
      navigate(`/chat/${encodeURIComponent(chatId)}`, {replace: true});
    }
  }, [chatId, loaded, message, navigate, shown]);

  // The photo (or Try again) has the focus while it is shown.
  useEffect(() => {
    if (!shown) {
      return;
    }
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() =>
        (state.status === 'error' ? retryRef.current?.getElement() : frameRef.current?.closest<HTMLElement>('[tabindex]'))?.focus({
          preventScroll: true,
        }),
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [shown, state.status]);

  const retry = useCallback(() => setAttempt(count => count + 1), []);

  return (
    <div className={shown ? 'photo-view-layer' : 'photo-view-layer photo-view-layer--closed'} inert={!shown} aria-hidden={!shown}>
      {state.status === 'error' ? (
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
                <Button ref={retryRef} title={t('retry')} onClick={retry} />
              </ButtonRail>
            </div>
          </div>
        </Page>
      ) : (
        <Page showHeader={false} enableSystemBarInset={false}>
          <ScrollView tabIndex={0} ariaLabel={state.status === 'ready' ? label : t('photoLoading')}>
            <div ref={frameRef} className="content-inset photo-frame" role={state.status === 'ready' ? undefined : 'status'}>
              {state.status === 'ready' ? (
                <img className="photo-image" src={state.photo.src} alt={caption ? `${label}: ${caption}` : label} />
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
      )}
    </div>
  );
}
