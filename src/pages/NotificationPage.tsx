import {useEffect, useMemo, useRef} from 'react';
import {Navigate, useNavigate, useParams} from 'react-router-dom';
import {findListedChat, parseShortcut} from '../telegram/dialogId';
import {useChat} from '../ChatProvider';
import {chatPath} from './ChatListPage';
import {StatusPage} from './StatusPage';

/** Opened by Lumen from a phone notification: `{shortcut}` is Telegram's `ndid_<dialogId>`. */
export const NOTIFICATION_PATH = '/notification/:shortcut';

/**
 * Finds the notification's chat and replaces this entry with it, so Back from
 * the conversation leads to the chat list. A shortcut that is not a dialog,
 * or a chat that cannot be found, opens the list.
 */
export function NotificationPage() {
  const {shortcut = ''} = useParams();
  const navigate = useNavigate();
  const {phase, chats, syncing, resolveDialog} = useChat();
  const dialog = useMemo(() => parseShortcut(shortcut), [shortcut]);
  const listed = dialog != null && phase.kind === 'ready' ? findListedChat(dialog, chats) : undefined;
  // Not in the cached list: wait for Telegram's list, then look the chat up.
  const lookUp = dialog != null && listed == null && phase.kind === 'ready' && !syncing;
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!lookUp || dialog == null || startedRef.current) {
      return;
    }
    startedRef.current = true;
    void resolveDialog(dialog).then(chatId => {
      if (mountedRef.current) {
        navigate(chatId ? chatPath(chatId) : '/', {replace: true});
      }
    });
  }, [dialog, lookUp, navigate, resolveDialog]);

  if (dialog == null || phase.kind === 'setup' || phase.kind === 'invalid-config' || phase.kind === 'error') {
    return <Navigate to="/" replace />;
  }
  if (listed != null) {
    return <Navigate to={chatPath(listed.id)} replace />;
  }
  return <StatusPage phase={{kind: 'connecting'}} />;
}
