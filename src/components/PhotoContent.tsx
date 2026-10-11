import imageFilled from '@wearables-ui-toolkit/icons/svg/image__filled.svg';
import {IconImage, TextStyle, TextView} from '@wearables-ui-toolkit/mrbd';
import {useEffect} from 'react';
import type {ChatMessage} from '../telegram/model';

/**
 * A photo's thumbnail in its bubble. The box has the photo's shape from the
 * start (its size from the message, else 4:3), so nothing moves when the
 * image arrives; until then, or without one, it shows an image icon.
 */
export function PhotoBox({src, width, height, alt}: {src: string | null; width?: number; height?: number; alt: string}) {
  const shape = {aspectRatio: width && height ? `${width} / ${height}` : '4 / 3'};
  return (
    <div className="photo-box" style={shape}>
      {src ? <img className="photo-box-image" src={src} alt={alt} decoding="async" /> : <IconImage className="photo-box-icon" source={imageFilled} />}
    </div>
  );
}

/**
 * A photo from the conversation: its thumbnail and caption. Its bubble asks
 * for the thumbnail (Telegram's 320 px size) while it is rendered; the tiny
 * preview that came with the message stands in until then.
 */
export function PhotoContent({
  message,
  thumbnail,
  alt,
  onNeedThumbnail,
}: {
  message: ChatMessage;
  thumbnail: string | null;
  alt: string;
  onNeedThumbnail: (message: ChatMessage) => void;
}) {
  useEffect(() => {
    onNeedThumbnail(message);
    // Asked once per bubble on screen; a refreshed copy of the message is the same photo.
  }, [message.chatId, message.id, onNeedThumbnail]);
  const {text, width, height} = message.content;
  return (
    <div className="sent-photo">
      <PhotoBox src={thumbnail} width={width} height={height} alt={alt} />
      {text ? (
        <TextView className="message-text" as="p" textStyle={TextStyle.BODY2}>
          {text}
        </TextView>
      ) : null}
    </div>
  );
}
