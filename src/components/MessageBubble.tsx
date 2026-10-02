// One chat bubble; based on the UI Toolkit messaging example. Activating a
// bubble opens its context menu (View for photos, Listen/Pause and Transcribe
// for voice messages, the four reactions the chat accepts, Reply). Reactions
// show as a badge under the bubble's bottom-right corner.

import arrowBigReplyFilled from '@wearables-ui-toolkit/icons/svg/arrowbigreply__filled.svg';
import circlePlayFilled from '@wearables-ui-toolkit/icons/svg/circleplay__filled.svg';
import expandFilled from '@wearables-ui-toolkit/icons/svg/expand__filled.svg';
import mediaPauseFilled from '@wearables-ui-toolkit/icons/svg/mediapause__filled.svg';
import speechBubbleMessageFilled from '@wearables-ui-toolkit/icons/svg/speechbubblemessage__filled.svg';
import {
  ButtonContextMenuItemView,
  Chip,
  ChipStyle,
  Container,
  ContextMenu,
  CornerRadius,
  DismissReason,
  EmojiContextMenuItemView,
  IconImage,
  IndeterminateLoader,
  IndeterminateLoaderSize,
  MaterialLibrary,
  ProgressIndicator,
  ProgressIndicatorSize,
  TailShapeProvider,
  TextColor,
  TextStyle,
  TextView,
  Toast,
  TooltipMode,
  type ButtonHandle,
} from '@wearables-ui-toolkit/mrbd';
import {useLayoutEffect, useMemo, useRef, useState, type MouseEvent} from 'react';
import {describeContent, formatBubbleTime, formatDuration, isMarker, isVoiceNote, snippet} from '../format';
import {t} from '../i18n/strings';
import type {AudioState} from '../state/useAudioPlayer';
import {displayEmoji} from '../telegram/convert';
import type {ChatMessage, ReactionSummary} from '../telegram/model';
import type {ReactionOption} from '../telegram/reactions';

type MessageBubbleProps = {
  message: ChatMessage;
  /** Shows the sender name above the first bubble of a run (group chats). */
  showSender: boolean;
  /** Shows the time below the last bubble of a run. */
  endsRun: boolean;
  initialFocusEligible: boolean;
  /** The four menu reactions for this chat (not allowed ones are disabled). */
  reactionOptions: ReactionOption[];
  /** Player state when this is the voice message being played. */
  audio?: AudioState;
  onReact: (message: ChatMessage, emoji: string) => void;
  onReply: (message: ChatMessage) => void;
  onView: (message: ChatMessage) => void;
  onToggleAudio: (message: ChatMessage) => void;
  onTranscribe: (message: ChatMessage) => void;
  /** The host can transcribe (window.lumen.audio, or demo mode). */
  transcribeAvailable: boolean;
  /** Transcript made this session, shown under a voice message. */
  transcript?: string | null;
};

const OUTBOUND_TOKEN_NAMES = {
  idleFill: '--uit-color-background-message-outbound',
  gradientStep1: '--uit-color-container-message-outbound-target-step1',
  gradientStep2: '--uit-color-container-message-outbound-target-step2',
  gradientStep3: '--uit-color-container-message-outbound-target-step3',
  gradientStep4: '--uit-color-container-message-outbound-target-step4',
  glowTint: '--uit-color-container-message-outbound-glow',
} as const;

function resolveColorToken(token: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (value.length === 0) {
    throw new Error(`Missing toolkit color token: ${token}`);
  }
  return value;
}

// The bubble exposes the same focus handle shape as a toolkit Button trigger.
type TriggerHandle = Pick<ButtonHandle, 'getElement'>;

type ReactionItemProps = {option: ReactionOption; onChoose: (emoji: string, event?: MouseEvent<HTMLElement>) => void};

function ReactionItem({option, onChoose}: ReactionItemProps) {
  const choose = (event?: MouseEvent<HTMLElement>) => onChoose(option.emoji, event);
  const emoji = displayEmoji(option.emoji);
  return (
    <EmojiContextMenuItemView
      emoji={emoji}
      disabled={!option.allowed}
      ariaLabel={option.allowed ? t('reactWith', {emoji}) : t('reactionNotAllowed', {emoji})}
      onClick={choose}
    />
  );
}

function reactionsText(reactions: ReactionSummary[]): string {
  return reactions.map(reaction => `${displayEmoji(reaction.emoji)} ${reaction.count}`).join(', ');
}

function reactionCount(reactions: ReactionSummary[] | undefined): number {
  return (reactions ?? []).reduce((total, reaction) => total + reaction.count, 0);
}

function audioDescription(message: ChatMessage, audio: AudioState | undefined): string {
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

function AudioContent({message, audio, transcript}: {message: ChatMessage; audio?: AudioState; transcript?: string | null}) {
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

export function MessageBubble({
  message,
  showSender,
  endsRun,
  initialFocusEligible,
  reactionOptions,
  audio,
  onReact,
  onReply,
  onView,
  onToggleAudio,
  onTranscribe,
  transcribeAvailable,
  transcript,
}: MessageBubbleProps) {
  const isOutgoing = message.fromMe;
  const reactions = message.reactions;
  const isAudio = message.content.kind === 'audio';
  const isPhoto = message.content.kind === 'photo';
  const tailDirection = endsRun ? (isOutgoing ? 'right' : 'left') : 'none';
  const shapeProvider = useMemo(
    () => new TailShapeProvider(tailDirection, CornerRadius.MEDIUM),
    [tailDirection],
  );
  const material = useMemo(() => {
    if (!isOutgoing) {
      return MaterialLibrary.inboundMessage();
    }
    return MaterialLibrary.outboundMessage({
      idleFill: resolveColorToken(OUTBOUND_TOKEN_NAMES.idleFill),
      gradientStep1: resolveColorToken(OUTBOUND_TOKEN_NAMES.gradientStep1),
      gradientStep2: resolveColorToken(OUTBOUND_TOKEN_NAMES.gradientStep2),
      gradientStep3: resolveColorToken(OUTBOUND_TOKEN_NAMES.gradientStep3),
      gradientStep4: resolveColorToken(OUTBOUND_TOKEN_NAMES.gradientStep4),
      glowTint: resolveColorToken(OUTBOUND_TOKEN_NAMES.glowTint),
    });
  }, [isOutgoing]);
  const text = describeContent(message.content);
  const time = formatBubbleTime(message.timestamp);
  const sender = isOutgoing ? t('you') : message.senderName;
  const body = isAudio ? audioDescription(message, audio) : text;
  const spokenBase = sender ? t('bubbleLabel', {sender, text: body, time}) : `${body}, ${time}`;
  const spoken = reactions?.length
    ? `${spokenBase}, ${t('reactionsLabel', {list: reactionsText(reactions)})}`
    : spokenBase;
  const reactionTotal = reactionCount(reactions);

  const [menuOpen, setMenuOpen] = useState(false);
  // Public handle for the bubble that opens the menu, used to return focus to it.
  const bubbleElementRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<TriggerHandle>({getElement: () => bubbleElementRef.current});

  const shouldReturnFocusToTriggerRef = useRef(false);
  useLayoutEffect(() => {
    if (!menuOpen && shouldReturnFocusToTriggerRef.current) {
      shouldReturnFocusToTriggerRef.current = false;
      triggerRef.current?.getElement()?.focus({preventScroll: true});
    }
  }, [menuOpen]);

  const toggleMenu = () => {
    // The menu still opens (View, Reply); a chat without reactions says so once.
    if (!menuOpen && reactionOptions.every(option => !option.allowed)) {
      Toast.show(t('reactionsOff'));
    }
    setMenuOpen(open => !open);
  };
  const dismissMenuToTrigger = (event?: MouseEvent<HTMLElement>) => {
    // Menu items render in a portal owned by the bubble; keep the click from
    // reaching the bubble and reopening the menu.
    event?.stopPropagation();
    shouldReturnFocusToTriggerRef.current = true;
    setMenuOpen(false);
  };
  const chooseReaction = (emoji: string, event?: MouseEvent<HTMLElement>) => {
    dismissMenuToTrigger(event);
    onReact(message, emoji);
  };
  const chooseReply = (event?: MouseEvent<HTMLElement>) => {
    event?.stopPropagation();
    setMenuOpen(false);
    onReply(message);
  };
  const chooseListen = (event?: MouseEvent<HTMLElement>) => {
    // Back on the bubble, where the position and progress show.
    dismissMenuToTrigger(event);
    onToggleAudio(message);
  };
  const chooseTranscribe = (event?: MouseEvent<HTMLElement>) => {
    event?.stopPropagation();
    setMenuOpen(false);
    onTranscribe(message);
  };
  const playing = audio?.status === 'playing';
  const chooseView = (event?: MouseEvent<HTMLElement>) => {
    event?.stopPropagation();
    setMenuOpen(false);
    onView(message);
  };

  const menu = (
    <ContextMenu
      aria-label={t('messageActionsLabel', {message: text})}
      onDismiss={reason => {
        if (reason === DismissReason.BACK_BUTTON || reason === DismissReason.NAVIGATION) {
          dismissMenuToTrigger();
        }
      }}>
      {isPhoto ? (
        <ButtonContextMenuItemView title={t('viewAction')} icon={expandFilled} onClick={chooseView} />
      ) : null}
      {isAudio ? (
        <ButtonContextMenuItemView
          title={playing ? t('pauseAction') : t('listenAction')}
          icon={playing ? mediaPauseFilled : circlePlayFilled}
          onClick={chooseListen}
        />
      ) : null}
      {isAudio ? (
        <ButtonContextMenuItemView
          title={t('transcribeAction')}
          ariaLabel={transcribeAvailable ? undefined : t('transcribeUnavailable')}
          icon={speechBubbleMessageFilled}
          disabled={!transcribeAvailable}
          onClick={chooseTranscribe}
        />
      ) : null}
      {reactionOptions.map(option => (
        <ReactionItem key={option.emoji} option={option} onChoose={chooseReaction} />
      ))}
      <ButtonContextMenuItemView
        title={t('replyAction')}
        icon={arrowBigReplyFilled}
        onClick={chooseReply}
      />
    </ContextMenu>
  );

  return (
    <div
      className={`message-row ${isOutgoing ? 'message-row--outgoing' : ''}`}>
      <div className="message-column">
        {showSender && message.senderName ? (
          <TextView
            className="message-sender"
            as="p"
            textStyle={TextStyle.META2}
            textColor={TextColor.SECONDARY}>
            {message.senderName}
          </TextView>
        ) : null}
        <div className="message-stack">
          <Container
            ref={bubbleElementRef}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            ariaLabel={t('messageActionsLabel', {message: spoken})}
            clickable
            focusable
            initialFocusEligible={initialFocusEligible}
            material={material}
            onClick={toggleMenu}
            shapeProvider={shapeProvider}
            tooltipMode={menuOpen ? TooltipMode.FOCUSED : TooltipMode.NONE}
            tooltipFocusable
            tooltipHidesFocusState
            tooltipContentDescription={t('messageActionsLabel', {message: text})}
            tooltipContent={menu}>
            <div className="message-bubble-content">
              {isAudio ? (
                <AudioContent message={message} audio={audio} transcript={transcript} />
              ) : (
                <TextView
                  className="message-text"
                  as="p"
                  textStyle={TextStyle.BODY2}
                  textColor={isMarker(message.content) ? TextColor.SECONDARY : undefined}>
                  {text}
                </TextView>
              )}
            </div>
          </Container>
          {reactions?.length ? (
            <div className="message-reactions" aria-hidden="true">
              <Chip
                chipStyle={ChipStyle.ELEVATED}
                text={reactions.map(reaction => displayEmoji(reaction.emoji)).join('')}
                metadata={reactionTotal > 1 ? String(reactionTotal) : undefined}
              />
            </div>
          ) : null}
        </div>
        {endsRun ? (
          <TextView
            className="message-timestamp"
            as="p"
            textStyle={TextStyle.META2}
            textColor={TextColor.SECONDARY}>
            {time}
          </TextView>
        ) : null}
      </div>
    </div>
  );
}
