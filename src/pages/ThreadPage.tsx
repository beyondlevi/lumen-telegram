import {useRef} from 'react';
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
import {PhotoSend} from './PhotoSendPage';
import {StatusPage} from './StatusPage';
import {Thread, type ThreadProps} from './Thread';

export {photoPath} from './Thread';

export function ThreadPage() {
  const {chatId} = useParams();
  const {phase} = useChat();
  const location = useLocation();
  const navigate = useNavigate();

  if (!chatId) {
    return <Navigate to="/" replace />;
  }
  if (phase.kind !== 'ready') {
    return <StatusPage phase={phase} />;
  }
  return <Conversation chatId={chatId} location={location} navigate={navigate} />;
}

/** The conversation, and the photo just taken drawn over it (see usePhotoFlow). */
function Conversation({chatId, location, navigate}: {chatId: string; location: Location; navigate: NavigateFunction}) {
  const {sendPhoto, chatFor, contactName} = useChat();
  const photos = usePhotoFlow({jid: chatId, pathname: location.pathname, state: location.state, navigate, sendPhoto});
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
  // Under the photo the conversation keeps its props, so Back draws nothing again.
  const kept = useRef(threadProps);
  if (!photos.open) {
    kept.current = threadProps;
  }
  const chat = chatFor(chatId);
  return (
    <>
      <KeptPage shown={!photos.open} onLive={photos.conversationLive}>
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
      <PhotoInput ref={photos.inputRef} onPhoto={photos.photoTaken} />
      <div ref={photos.focusParkRef} className="focus-park" tabIndex={-1} aria-hidden="true" />
    </>
  );
}
