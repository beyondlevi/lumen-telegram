import {Button, ButtonRail, InputTextView, Page, ScrollView, type ButtonHandle} from '@wearables-ui-toolkit/mrbd';
import {useCallback, useEffect, useRef, useState, type FocusEvent} from 'react';
import {t} from '../i18n/strings';
import type {CapturedPhoto} from '../photo/capturedPhoto';

/**
 * The photo just taken, before it is sent: its preview, an optional caption
 * (a real text field, so Lumen's keyboard offers dictation, writing with the
 * band and the phone), and Send, Retake and Cancel. It is drawn over the
 * conversation, which stays mounted under it; Back (the middle tap) leaves
 * without sending, and the screen goes under the conversation until it is
 * dropped in idle time (unmounting it at once would delay the frame).
 */
export function PhotoSend({
  shown,
  photo,
  name,
  onSend,
  onRetake,
  onCancel,
}: {
  /** False once closed: the screen stays under the conversation until it is dropped. */
  shown: boolean;
  photo: CapturedPhoto;
  name: string;
  onSend: (caption: string) => void;
  onRetake: () => void;
  onCancel: () => void;
}) {
  const [caption, setCaption] = useState('');
  const sendButtonRef = useRef<ButtonHandle>(null);

  // Send has the focus when the screen opens; Up reaches the caption.
  useEffect(() => {
    if (!shown) {
      return;
    }
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => sendButtonRef.current?.getElement()?.focus({preventScroll: true}));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [shown]);

  const send = useCallback(() => onSend(caption.trim()), [caption, onSend]);

  // The host hands focus to the document root while its own text entry is
  // open; take it back so the caption keeps the focus when the text arrives.
  const handleCaptionBlur = useCallback((event: FocusEvent<HTMLTextAreaElement>) => {
    const input = event.currentTarget;
    window.requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (input.isConnected && (focused == null || focused === document.body || focused === document.documentElement)) {
        input.focus({preventScroll: true});
      }
    });
  }, []);

  return (
    <div className={shown ? 'photo-send-layer' : 'photo-send-layer photo-send-layer--closed'} inert={!shown} aria-hidden={!shown}>
      <Page headerText={t('photoSendHeader')} enableSystemBarInset={false}>
        <div className="action-page-shell">
          <ScrollView insetForHeader ariaLabel={t('photoSendLabel', {name})}>
            <div className="content-inset photo-send">
              <img className="photo-send-preview" src={photo.url} alt={t('photoPreviewAlt')} />
              <InputTextView
                text={caption}
                hint={t('captionHint')}
                showActionButton={false}
                onTextChange={setCaption}
                onSend={send}
                inputProps={{'aria-label': t('captionLabel'), enterKeyHint: 'send', onBlur: handleCaptionBlur}}
              />
            </div>
          </ScrollView>
          <div className="action-dock">
            <ButtonRail>
              <Button ref={sendButtonRef} title={t('sendPhotoAction')} onClick={send} />
              <Button title={t('retakeAction')} onClick={onRetake} />
              <Button title={t('cancelAction')} onClick={onCancel} />
            </ButtonRail>
          </div>
        </div>
      </Page>
    </div>
  );
}
