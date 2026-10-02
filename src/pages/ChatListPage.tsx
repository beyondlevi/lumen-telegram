import {
  ListItem,
  Page,
  StatusIndicatorType,
  TimestampPosition,
  TimestampTextColor,
  VerticalList,
} from '@wearables-ui-toolkit/mrbd';
import {useEffect} from 'react';
import {useNavigate} from 'react-router-dom';
import {avatarFallback} from '../components/avatarFallback';
import {chatDisplayName, chatPreview, formatListTime} from '../format';
import {t} from '../i18n/strings';
import {useReturnOrder} from '../state/useReturnOrder';
import {useChat} from '../ChatProvider';
import {ChatListEmptyPage} from './ChatListEmptyPage';
import {StatusPage} from './StatusPage';

export function chatPath(chatId: string): string {
  return `/chat/${encodeURIComponent(chatId)}`;
}

export function ChatListPage() {
  const navigate = useNavigate();
  const {phase, chats, offline, syncing, isUnread, listOrder, avatarFor, requestAvatar} = useChat();

  const rows = useReturnOrder(chats, listOrder);

  // Profile pictures load once per chat while the list is shown.
  useEffect(() => {
    for (const chat of rows) {
      requestAvatar(chat);
    }
  }, [requestAvatar, rows]);

  if (phase.kind !== 'ready') {
    return <StatusPage phase={phase} />;
  }
  if (chats.length === 0) {
    return <ChatListEmptyPage offline={offline} />;
  }

  return (
    <Page
      headerText={syncing ? t('loadingHeader') : t('chatsHeader')}
      headerIsLoading={syncing}
      headerMetadata={offline && !syncing ? t('offlineMeta') : undefined}
      enableSystemBarInset={false}>
      <VerticalList insetForHeader ariaLabel={t('chatListLabel')}>
        {rows.map(chat => {
          const name = chatDisplayName(chat);
          const unread = isUnread(chat);
          const picture = avatarFor(chat.id);
          return (
            <ListItem
              key={chat.id}
              title={name}
              subtitle={chatPreview(chat)}
              timestamp={formatListTime(chat.timestamp)}
              timestampPosition={TimestampPosition.ACCESSORY_TOP}
              timestampTextColor={unread ? TimestampTextColor.ACCENT : TimestampTextColor.PRIMARY}
              avatarSrc={picture ?? undefined}
              avatarPrimaryContent={picture ? undefined : avatarFallback(chat.name, chat.isGroup)}
              avatarAlt={name}
              avatarStatusIndicator={unread ? StatusIndicatorType.UNREAD : undefined}
              onClick={() => navigate(chatPath(chat.id))}
            />
          );
        })}
      </VerticalList>
    </Page>
  );
}
