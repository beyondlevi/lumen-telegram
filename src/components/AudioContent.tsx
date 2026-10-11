// A voice message or audio file in its bubble: play state, progress, length and transcript.
import circlePlayFilled from '@wearables-ui-toolkit/icons/svg/circleplay__filled.svg';
import mediaPauseFilled from '@wearables-ui-toolkit/icons/svg/mediapause__filled.svg';
import {
  IconImage,
  IndeterminateLoader,
  IndeterminateLoaderSize,
  ProgressIndicator,
  ProgressIndicatorSize,
  TextColor,
  TextStyle,
  TextView,
} from '@wearables-ui-toolkit/mrbd';
import {formatDuration, isVoiceNote, snippet} from '../format';
import {t} from '../i18n/strings';
import type {AudioState} from '../state/useAudioPlayer';
import type {ChatMessage} from '../telegram/model';

export function audioDescription(message: ChatMessage, audio: AudioState | undefined): string {
  const duration = formatDuration(audio?.duration || message.content.seconds || 0);
  const position = formatDuration(audio?.position ?? 0);
  switch (audio?.status) {
    case 'playing':
      return t('audioPlaying', {position, duration});
    case 'paused':
      return t('audioPaused', {position, duration});
    case 'loading':
      return t('audioLoading');
    default:
      return t(isVoiceNote(message.content) ? 'audioLabel' : 'audioFileLabel', {duration});
  }
}

const TRANSCRIPT_PREVIEW_LENGTH = 90;

export function AudioContent({message, audio, transcript}: {message: ChatMessage; audio?: AudioState; transcript?: string | null}) {
  const status = audio?.status ?? 'idle';
  const duration = audio?.duration || message.content.seconds || 0;
  const position = audio?.position ?? 0;
  const started = status === 'playing' || status === 'paused';
  return (
    <div className="audio-block">
      <div className="audio-content">
        {status === 'loading' ? (
          <IndeterminateLoader size={IndeterminateLoaderSize.SMALL} />
        ) : (
          <IconImage className="audio-icon" source={status === 'playing' ? mediaPauseFilled : circlePlayFilled} />
        )}
        <div className="audio-track">
          <ProgressIndicator
            size={ProgressIndicatorSize.THIN}
            value={started ? position : 0}
            maximumValue={duration || 1}
            isActive={status === 'playing'}
            announceUpdatesForAccessibility={false}
            aria-label={t(isVoiceNote(message.content) ? 'audioLabel' : 'audioFileLabel', {duration: formatDuration(duration)})}
          />
          <TextView as="p" textStyle={TextStyle.META2} textColor={TextColor.SECONDARY}>
            {status === 'error'
              ? t('markerAudio')
              : started
                ? `${formatDuration(position)} / ${formatDuration(duration)}`
                : formatDuration(duration)}
          </TextView>
        </div>
      </div>
      {transcript ? (
        <TextView as="p" className="audio-transcript" textStyle={TextStyle.META1}>
          {snippet(transcript, TRANSCRIPT_PREVIEW_LENGTH)}
        </TextView>
      ) : null}
    </div>
  );
}
