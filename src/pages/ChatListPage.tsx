import microphoneFilled from '@wearables-ui-toolkit/icons/svg/microphone__filled.svg';
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
import {useVoiceInput} from '../search/useVoiceInput';
import {useReturnOrder} from '../state/useReturnOrder';
import {useChat} from '../ChatProvider';
import {ChatListEmptyPage} from './ChatListEmptyPage';
import {DEMO_SEARCH_PHRASE, SEARCH_PATH} from './SearchPage';
import {StatusPage} from './StatusPage';

export function chatPath(chatId: string): string {
  return `/chat/${encodeURIComponent(chatId)}`;
}

export function ChatListPage() {
  const navigate = useNavigate();
  const {phase, chats, offline, syncing, isUnread, listOrder, avatarFor, requestAvatar, demo} = useChat();
  const voice = useVoiceInput(demo ? DEMO_SEARCH_PHRASE : null);

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
        {/* Above the first chat, one Up away; the first chat keeps the initial focus. */}
        {voice.input != null ? (
          <ListItem
            title={t('voiceSearchRow')}
            subtitle={t('voiceSearchHint')}
            icon={microphoneFilled}
            initialFocusEligible={false}
            onClick={() => navigate(SEARCH_PATH)}
          />
        ) : null}
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
