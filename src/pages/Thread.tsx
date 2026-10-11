// A conversation: its messages (in a window, see useMessageWindow), the reply
// field and the Reply | Voice | Photos rail.
import imageFilled from '@wearables-ui-toolkit/icons/svg/image__filled.svg';
import microphoneFilled from '@wearables-ui-toolkit/icons/svg/microphone__filled.svg';
import {
  Button,
  ButtonRail,
  InputTextView,
  Page,
  TextStyle,
  TextView,
  Toast,
  VerticalList,
  type ButtonHandle,
  type PageHandle,
} from '@wearables-ui-toolkit/mrbd';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
} from 'react';
import type {NavigateFunction} from 'react-router-dom';
import {avatarFallback} from '../components/avatarFallback';
import {MessageBubble} from '../components/MessageBubble';
import {failureReason} from '../failure';
import {chatDisplayName, describeContent, endsMessageRun, snippet, startsMessageRun} from '../format';
import {t} from '../i18n/strings';
import type {ChatMessage} from '../telegram/model';
import {displayEmoji} from '../telegram/convert';
import {reactionOptions} from '../telegram/reactions';
import {useAudioPlayer} from '../state/useAudioPlayer';
import {useHeaderHeight} from '../state/useHeaderHeight';
import {useMessageWindow} from '../state/useListWindow';
import {useLongMessageScroll} from '../state/useLongMessageScroll';
import {useChat} from '../ChatProvider';
import {recordPath} from './RecordPage';
import {transcriptPath} from './TranscriptPage';

/**
 * How the conversation was left, read when it shows again: Voice opened the
 * recording screen, or a bubble opened a photo or a transcript. Any other
 * showing (from the list) is an opening of the conversation.
 */
const returnTo = {voice: false, bubble: false};

export function photoPath(chatId: string, messageId: string): string {
  return `/chat/${encodeURIComponent(chatId)}/photo/${encodeURIComponent(messageId)}`;
}

export type ThreadProps = {chatId: string; pathname: string; locationKey: string; composerOpen: boolean; navigate: NavigateFunction};

/** Moves the focus from an older bubble of the list to the newest one. */
function focusNewestBubble(list: HTMLElement | null | undefined) {
  const focused = document.activeElement;
  if (list == null || !(focused instanceof HTMLElement) || !list.contains(focused)) {
    return;
  }
  const rows = list.querySelectorAll('.message-row');
  const newest = rows[rows.length - 1]?.querySelector<HTMLElement>('[aria-haspopup="menu"]');
  if (newest != null && !newest.contains(focused)) {
    newest.focus({preventScroll: true});
  }
}

// A page stays rendered while the next one comes in, and every navigation
// gives it a new location object; with primitives for props, the conversation
// is not drawn again on its way out (Back to the list).
export const Thread = memo(function Thread({chatId, pathname, locationKey, composerOpen, navigate}: ThreadProps) {
  const {chatFor, thread, openThread, sendText, sendReaction, offline, avatarFor, requestAvatar, loadMedia, allowedReactions, audio: lumenAudio, transcriptFor, contactName} =
    useChat();
  const chat = chatFor(chatId);
  // A contact found by voice search may have no conversation in the list yet.
  const savedName = chat?.name ?? contactName(chatId);
  const name = chat?.name ? chatDisplayName(chat) : savedName ?? chatDisplayName(chat);
  const {loaded, synced, messages: records} = thread(chatId);
  const isGroup = chat?.isGroup ?? false;
  const messages = records;
  const messageIds = useMemo(() => messages.map(message => message.id), [messages]);
  const messageWindow = useMessageWindow(chatId, messageIds);
  const allowed = allowedReactions(chatId);
  const options = useMemo(() => reactionOptions(allowed), [allowed]);
  const avatar = avatarFor(chatId);

  useEffect(() => requestAvatar(chat), [chat, requestAvatar]);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Message chosen with the bubble menu's Reply; sent as a quoted reply.
  const [quoted, setQuoted] = useState<ChatMessage | null>(null);
  const replyButtonRef = useRef<ButtonHandle>(null);
  const voiceButtonRef = useRef<ButtonHandle>(null);
  const pageRef = useRef<PageHandle>(null);
  // Marks the end of the conversation (below the newest bubble and its time).
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const longMessages = useLongMessageScroll(listRef);
  const headerHeight = useHeaderHeight(pageRef);

  const showAudioError = useCallback(
    (error: unknown) => Toast.show(t('audioFailed', {reason: error instanceof Error && error.message === 'decode' ? t('reasonFormat') : failureReason(error)})),
    [],
  );
  const [audio, toggleAudio] = useAudioPlayer(loadMedia, showAudioError);

  const composerWasOpenRef = useRef(false);
  useLayoutEffect(() => {
    if (composerWasOpenRef.current && !composerOpen) {
      setDraft('');
      setQuoted(null);
      replyButtonRef.current?.getElement()?.focus({preventScroll: true});
    }
    composerWasOpenRef.current = composerOpen;
  }, [composerOpen]);

  const openComposer = useCallback(
    (message: ChatMessage | null) => {
      setQuoted(message);
      if (!composerOpen) {
        navigate(pathname, {state: {replyComposer: true}});
      }
    },
    [composerOpen, navigate, pathname],
  );
  const startReply = useCallback(() => openComposer(null), [openComposer]);
  const keepWindow = messageWindow.keep;
  const viewPhoto = useCallback(
    (message: ChatMessage) => {
      returnTo.bubble = true;
      keepWindow();
      navigate(photoPath(chatId, message.id));
    },
    [chatId, keepWindow, navigate],
  );
  const transcribe = useCallback(
    (message: ChatMessage) => {
      returnTo.bubble = true;
      keepWindow();
      navigate(transcriptPath(chatId, message.id));
    },
    [chatId, keepWindow, navigate],
  );
  const record = useCallback(() => {
    returnTo.voice = true;
    keepWindow();
    navigate(recordPath(chatId));
  }, [chatId, keepWindow, navigate]);
  // Each time the conversation shows (not the reply composer), after the route
  // has restored the focus and scroll of the previous visit:
  // - back from the recording screen: focus Voice, with the sent note in view;
  // - back from a photo or a transcript: keep the restored bubble;
  // - opened from the list: show the newest message. The restored focus may be
  //   an older bubble and the restored scroll leaves newer ones (such as a voice
  //   note sent last time) under the rail, out of view and skipped by Up.
  useEffect(() => {
    if (composerOpen || pathname !== `/chat/${encodeURIComponent(chatId)}`) {
      return;
    }
    const fromVoice = returnTo.voice;
    const fromBubble = returnTo.bubble;
    returnTo.voice = false;
    returnTo.bubble = false;
    if (fromBubble && !fromVoice) {
      return;
    }
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        if (fromVoice) {
          voiceButtonRef.current?.getElement()?.focus({preventScroll: true});
        } else {
          focusNewestBubble(endRef.current?.parentElement);
        }
        longMessages.release();
        endRef.current?.scrollIntoView({block: 'end'});
      });
    });
    return () => window.cancelAnimationFrame(frame);
    // Once per showing of the conversation; new messages are revealed below.
  }, [chatId, locationKey, pathname, longMessages]);

  const react = useCallback(
    (message: ChatMessage, emoji: string) => {
      sendReaction(message, emoji)
        .then(result =>
          Toast.show(result === 'added' ? t('reactionSent', {emoji: displayEmoji(emoji)}) : t('reactionRemoved')),
        )
        .catch(error => Toast.show(t('reactionFailed', {reason: failureReason(error)})));
    },
    [sendReaction],
  );

  const lastMessageId = messages.length ? messages[messages.length - 1].id : null;
  const lastMessageFromMe = messages.length ? messages[messages.length - 1].fromMe : false;

  useEffect(() => openThread(chatId), [chatId, openThread]);

  // Reveal the newest message on entry, after sending (the taller reply field
  // may have pushed the end out of view), and when a new one arrives while the
  // end of the conversation is on screen (the reader is not reading older ones).
  const endVisibleRef = useRef(true);
  const revealedRef = useRef(false);
  useEffect(() => {
    const end = endRef.current;
    if (end == null || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(entries => {
      endVisibleRef.current = entries.some(entry => entry.isIntersecting);
    });
    observer.observe(end);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (lastMessageId == null) {
      return;
    }
    if (!revealedRef.current || endVisibleRef.current || lastMessageFromMe) {
      longMessages.release();
      endRef.current?.scrollIntoView({block: 'end'});
      revealedRef.current = true;
    }
  }, [lastMessageId, lastMessageFromMe, longMessages]);

  const handleSend = useCallback(
    (text: string) => {
      const body = text.trim();
      if (!body || sending) {
        return;
      }
      setSending(true);
      sendText(chatId, body, quoted)
        .then(() => {
          Toast.show(t('messageSent'));
          // Closing the composer entry clears the draft and refocuses Reply.
          navigate(-1);
        })
        .catch(error => {
          Toast.show(t('sendFailed', {reason: failureReason(error)}));
        })
        .finally(() => setSending(false));
    },
    [chatId, navigate, quoted, sendText, sending],
  );

  // The host hands focus to the document root while its own text entry (the
  // dictation composer) is open. Reclaim only that handoff so the reply field
  // keeps focus when the dictated text arrives.
  const handleDraftBlur = useCallback((event: FocusEvent<HTMLTextAreaElement>) => {
    const input = event.currentTarget;
    window.requestAnimationFrame(() => {
      const focused = document.activeElement;
      const focusLeftTheDocument =
        focused == null || focused === document.body || focused === document.documentElement;
      if (input.isConnected && focusLeftTheDocument) {
        input.focus({preventScroll: true});
      }
    });
  }, []);

  return (
    <Page
      ref={pageRef}
      headerText={name}
      headerShowAvatar
      headerAvatarSrc={avatar ?? undefined}
      headerAvatarPrimaryContent={avatar ? undefined : avatarFallback(savedName, isGroup)}
      headerAvatarAlt={name}
      headerIsLoading={!synced}
      headerMetadata={offline && synced ? t('offlineMeta') : undefined}
      enableSystemBarInset={false}>
      {/* The conversation starts below the header so no message runs under it. */}
      <div
        className={headerHeight > 0 ? 'thread-shell thread-shell--below-header' : 'thread-shell'}
        style={headerHeight > 0 ? ({'--thread-header-height': `${headerHeight}px`} as CSSProperties) : undefined}
        {...longMessages.handlers}
        onFocusCapture={messageWindow.onFocusCapture}>
        <VerticalList
          ref={listRef}
          insetForHeader={headerHeight === 0}
          contentClassName="message-list"
          ariaLabel={t('threadLabel', {name})}>
          {loaded && messages.length === 0 ? (
            <div className="thread-status" role="status">
              <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
                {t('threadEmptyTitle')}
              </TextView>
              <TextView as="p" textStyle={TextStyle.BODY2}>
                {t('threadEmptyBody')}
              </TextView>
            </div>
          ) : null}
          {messages.slice(messageWindow.first).map((message, offset) => {
            const index = messageWindow.first + offset;
            return (
              <MessageBubble
                key={message.id}
                message={message}
                showSender={isGroup && !message.fromMe && startsMessageRun(messages, index)}
                endsRun={endsMessageRun(messages, index)}
                initialFocusEligible={!composerOpen && index === messages.length - 1}
                reactionOptions={options}
                audio={audio.id === message.id ? audio : undefined}
                onReact={react}
                onReply={openComposer}
                onView={viewPhoto}
                onTranscribe={transcribe}
                transcribeAvailable={lumenAudio != null}
                transcript={message.content.kind === 'audio' ? transcriptFor(message.id) : null}
                onToggleAudio={toggleAudio}
              />
            );
          })}
          <div className="message-end" ref={endRef} />
        </VerticalList>
        <div className="action-dock">
          {composerOpen ? (
            <div className="draft-input">
              <InputTextView
                text={draft}
                hint={quoted ? t('quoteHint', {text: snippet(describeContent(quoted.content))}) : t('replyHint')}
                actionLabel={t('sendLabel')}
                loadingLabel={t('sendingLabel')}
                showLoader={sending}
                onTextChange={setDraft}
                onSend={handleSend}
                inputProps={{
                  'aria-label': t('replyFieldLabel', {name}),
                  autoFocus: true,
                  onBlur: handleDraftBlur,
                  readOnly: sending,
                }}
              />
            </div>
          ) : (
            <ButtonRail centerContentWhenSmallerThanWidth={false}>
              <Button
                ref={replyButtonRef}
                title={t('replyAction')}
                initialFocusEligible={messages.length === 0}
                onClick={startReply}
              />
              <Button
                ref={voiceButtonRef}
                title={t('voiceAction')}
                icon={microphoneFilled}
                disabled={lumenAudio == null}
                initialFocusEligible={false}
                onClick={record}
              />
              <Button title={t('photosAction')} icon={imageFilled} disabled initialFocusEligible={false} />
            </ButtonRail>
          )}
        </div>
      </div>
    </Page>
  );
});
