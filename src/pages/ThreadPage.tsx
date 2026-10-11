import {Navigate, useLocation, useNavigate, useParams} from 'react-router-dom';
import {useChat} from '../ChatProvider';
import {StatusPage} from './StatusPage';
import {Thread} from './Thread';

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
  const composerOpen =
    location.state != null &&
    typeof location.state === 'object' &&
    'replyComposer' in location.state &&
    location.state.replyComposer === true;
  return <Thread chatId={chatId} pathname={location.pathname} locationKey={location.key} composerOpen={composerOpen} navigate={navigate} />;
}
