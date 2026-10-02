import {App} from '@wearables-ui-toolkit/mrbd';
import {
  ReactRouterNavigationProvider,
  ReactRouterPageTransition,
} from '@wearables-ui-toolkit/mrbd/react-router';
import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';
import {ChatListPage} from './pages/ChatListPage';
import {PhotoPage} from './pages/PhotoPage';
import {ThreadPage} from './pages/ThreadPage';

// Back (Escape) is handled by ReactRouterNavigationProvider: from a photo it
// returns to the conversation, in a thread to the list; on the list, with no history left, it is not consumed,
// so the platform closes the app.
export default function TelegramApp() {
  return (
    <BrowserRouter>
      <ReactRouterNavigationProvider>
        <App>
          <ReactRouterPageTransition>
            {({location}) => (
              <Routes location={location}>
                <Route path="/" element={<ChatListPage />} />
                <Route path="/chat/:chatId" element={<ThreadPage />} />
                <Route path="/chat/:chatId/photo/:messageId" element={<PhotoPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            )}
          </ReactRouterPageTransition>
        </App>
      </ReactRouterNavigationProvider>
    </BrowserRouter>
  );
}
