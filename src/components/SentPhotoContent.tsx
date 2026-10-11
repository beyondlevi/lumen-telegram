import {IndeterminateLoader, IndeterminateLoaderSize, TextColor, TextStyle, TextView} from '@wearables-ui-toolkit/mrbd';
import {t} from '../i18n/strings';
import type {SentPhoto} from '../state/useChatState';
import {PhotoBox} from './PhotoContent';

/** The upload state of a photo you sent this session, as shown under it. */
export const PHOTO_STATE_KEYS = {sending: 'photoStateSending', sent: 'photoStateSent', failed: 'photoStateFailed'} as const;

export function SentPhotoContent({photo, caption, alt}: {photo: SentPhoto; caption: string; alt: string}) {
  return (
    <div className="sent-photo">
      <PhotoBox src={photo.thumbnail} width={photo.width} height={photo.height} alt={alt} />
      {caption ? (
        <TextView className="message-text" as="p" textStyle={TextStyle.BODY2}>
          {caption}
        </TextView>
      ) : null}
      <div className="sent-photo-state">
        {photo.state === 'sending' ? <IndeterminateLoader size={IndeterminateLoaderSize.SMALL} /> : null}
        <TextView as="p" textStyle={TextStyle.META2} textColor={TextColor.SECONDARY}>
          {t(PHOTO_STATE_KEYS[photo.state])}
        </TextView>
      </div>
    </div>
  );
}
