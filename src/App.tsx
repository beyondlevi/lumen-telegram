import {App} from '@wearables-ui-toolkit/mrbd';
import {
  ReactRouterNavigationProvider,
  ReactRouterPageTransition,
} from '@wearables-ui-toolkit/mrbd/react-router';
import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';
import {ChatListPage} from './pages/ChatListPage';
import {NotificationPage, NOTIFICATION_PATH} from './pages/NotificationPage';
import {PhotoPage} from './pages/PhotoPage';
import {RecordPage} from './pages/RecordPage';
import {SearchPage, SEARCH_PATH} from './pages/SearchPage';
import {ThreadPage} from './pages/ThreadPage';
import {TranscriptPage} from './pages/TranscriptPage';

// Back (Escape) is handled by ReactRouterNavigationProvider: from a photo it
// returns to the conversation, in a thread to the list; on the list, with no history left, it is not consumed,
// so the platform closes the app. A notification opens /notification/<shortcut>,
// which is replaced by its conversation.
export default function TelegramApp() {
  return (
    <BrowserRouter>
      <ReactRouterNavigationProvider>
        <App>
          <ReactRouterPageTransition>
            {({location}) => (
              <Routes location={location}>
                <Route path="/" element={<ChatListPage />} />
                <Route path={SEARCH_PATH} element={<SearchPage />} />
                <Route path={NOTIFICATION_PATH} element={<NotificationPage />} />
                <Route path="/chat/:chatId" element={<ThreadPage />} />
                <Route path="/chat/:chatId/photo/:messageId" element={<PhotoPage />} />
                <Route path="/chat/:chatId/record" element={<RecordPage />} />
                <Route path="/chat/:chatId/transcript/:messageId" element={<TranscriptPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            )}
          </ReactRouterPageTransition>
        </App>
      </ReactRouterNavigationProvider>
    </BrowserRouter>
  );
}
