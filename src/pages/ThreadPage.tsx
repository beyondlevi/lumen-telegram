import {useCallback, useLayoutEffect, useRef} from 'react';
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  type Location,
  type NavigateFunction,
} from 'react-router-dom';
import {KeptPage} from '../components/KeptPage';
import {PhotoInput} from '../photo/PhotoInput';
import {usePhotoFlow} from '../photo/usePhotoFlow';
import {chatDisplayName} from '../format';
import {useChat} from '../ChatProvider';
import {useClosingLayer} from '../state/useClosingLayer';
import {PhotoView} from './PhotoPage';
import {PhotoSend} from './PhotoSendPage';
import {StatusPage} from './StatusPage';
import {Thread, type ThreadProps} from './Thread';

export {photoPath} from './Thread';

export function ThreadPage() {
  const {chatId, messageId} = useParams();
  const {phase} = useChat();
  const location = useLocation();
  const navigate = useNavigate();

  if (!chatId) {
    return <Navigate to="/" replace />;
  }
  if (phase.kind !== 'ready') {
    return <StatusPage phase={phase} />;
  }
  return <Conversation chatId={chatId} viewed={messageId ?? null} location={location} navigate={navigate} />;
}

/**
 * The conversation, and drawn over it the photo just taken (see usePhotoFlow)
 * or a photo opened in full (`/chat/:chatId/photo/:messageId`, see PhotoView).
 */
function Conversation({
  chatId,
  viewed,
  location,
  navigate,
}: {
  chatId: string;
  viewed: string | null;
  location: Location;
  navigate: NavigateFunction;
}) {
  const {sendPhoto, chatFor, contactName} = useChat();
  const photos = usePhotoFlow({jid: chatId, pathname: location.pathname, state: location.state, navigate, sendPhoto});
  const view = useClosingLayer(viewed);
  const covered = photos.open || view.shown;
  const composerOpen =
    location.state != null &&
    typeof location.state === 'object' &&
    'replyComposer' in location.state &&
    location.state.replyComposer === true;
  const threadProps: ThreadProps = {
    chatId,
    pathname: location.pathname,
    locationKey: location.key,
    composerOpen,
    navigate,
    onTakePhoto: photos.take,
    photoButtonRef: photos.photoButtonRef,
  };
  // Under a photo the conversation keeps its props, so Back draws nothing again.
  const kept = useRef(threadProps);
  if (!covered) {
    kept.current = threadProps;
  }

  // Closing the photo, the focus waits (see usePhotoFlow) and then goes back to its bubble.
  const returnTo = useRef<string | null>(null);
  const wasViewing = useRef(view.shown);
  const focusPark = photos.focusParkRef;
  useLayoutEffect(() => {
    const closed = wasViewing.current && !view.shown;
    wasViewing.current = view.shown;
    if (!closed) {
      return;
    }
    returnTo.current = view.value;
    const focused = document.activeElement;
    if (focused === document.body || focused?.closest('.photo-view-layer') != null) {
      focusPark.current?.focus({preventScroll: true});
    }
  }, [focusPark, view.shown, view.value]);
  const conversationLive = photos.conversationLive;
  const live = useCallback(() => {
    conversationLive();
    const id = returnTo.current;
    returnTo.current = null;
    if (id != null) {
      document.querySelector<HTMLElement>(`[data-message="${CSS.escape(id)}"] [aria-haspopup="menu"]`)?.focus({preventScroll: true});
    }
  }, [conversationLive]);

  const chat = chatFor(chatId);
  return (
    <>
      <KeptPage shown={!covered} onLive={live}>
        <Thread {...kept.current} />
      </KeptPage>
      {photos.photo != null ? (
        <PhotoSend
          key={photos.session}
          shown={photos.open}
          photo={photos.photo}
          name={chat?.name ? chatDisplayName(chat) : contactName(chatId) ?? chatDisplayName(chat)}
          onSend={photos.send}
          onRetake={photos.retake}
          onCancel={photos.cancel}
        />
      ) : null}
      {view.value != null ? <PhotoView key={view.value} chatId={chatId} messageId={view.value} shown={view.shown} /> : null}
      <PhotoInput ref={photos.inputRef} onPhoto={photos.photoTaken} />
      <div ref={photos.focusParkRef} className="focus-park" tabIndex={-1} aria-hidden="true" />
    </>
  );
}
