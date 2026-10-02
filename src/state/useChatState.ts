import {Toast} from '@wearables-ui-toolkit/mrbd';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {accountKey, type ConfigField} from '../config/lumenConfig';
import {createDemoClient} from '../demo/demoClient';
import {setLocaleOverride, t} from '../i18n/strings';
import {isAbortError, TelegramError, type ChatApi} from '../telegram/api';
import {connectClient} from '../telegram/connect';
import {sameEmoji} from '../telegram/convert';
import {withMyReaction} from '../telegram/reactions';
import type {AllowedReactions, Chat, ChatMessage, ReactionSummary} from '../telegram/model';
import {createAvatarLoader} from './avatars';
import {loadChatCache, saveChatCache} from './chatCache';
import {createMediaLoader, type LoadedMedia} from './media';
import {loadReadMarks, saveReadMarks, type ReadMarks} from './readMarks';
import {useLumenConfig} from './useLumenConfig';

/** Most recent chats requested from Telegram. */
export const CHAT_LIMIT = 40;
/** Messages requested per conversation. */
export const MESSAGE_LIMIT = 30;
/** Fallback polling; Telegram pushes updates over the open connection. */
export const LIST_POLL_MS = 20000;
export const THREAD_POLL_MS = 10000;
/** A push update refreshes after this delay, so bursts of updates cost one request. */
const PUSH_REFRESH_MS = 400;
/** The phone's internet can take 5–15 s to come up after launch. */
export const CONNECT_RETRY_MS = 3000;
export const CONNECT_WINDOW_MS = 30000;

export type Phase =
  | {kind: 'setup'; missing: ConfigField[]}
  | {kind: 'invalid-config'; field: ConfigField}
  | {kind: 'connecting'}
  | {kind: 'error'; error: TelegramError}
  | {kind: 'ready'};

/** `loaded`: messages to show (maybe from the cache); `synced`: refreshed from Telegram this session. */
export type Thread = {loaded: boolean; synced: boolean; messages: ChatMessage[]};

export type ChatState = {
  phase: Phase;
  chats: Chat[];
  offline: boolean;
  /** Cached data is on screen while the first refresh runs. */
  syncing: boolean;
  isUnread(chat: Chat): boolean;
  thread(chatId: string): Thread;
  chatFor(chatId: string): Chat | undefined;
  retry(): void;
  /** Reads the platform configuration again (Setup screen). */
  reloadConfig(): void;
  /** Registers the conversation on screen; it is refreshed and marked as read. */
  openThread(chatId: string): () => void;
  /** Sends a text, optionally as a reply to `quoted`. */
  sendText(chatId: string, text: string, quoted?: ChatMessage | null): Promise<void>;
  /** Sets your reaction (choosing your current one again removes it). */
  sendReaction(message: ChatMessage, emoji: string): Promise<'added' | 'removed'>;
  /** Reactions the chat accepts; null until known. */
  allowedReactions(chatId: string): AllowedReactions | null;
  /** Loaded profile photo of a chat, or null (initials are shown). */
  avatarFor(chatId: string): string | null;
  /** Starts loading a chat's profile photo once. */
  requestAvatar(chat: Chat | undefined): void;
  /** Downloads a photo or voice message on demand (kept in memory for the session). */
  loadMedia(message: ChatMessage): Promise<LoadedMedia>;
  /** Chat order last shown by the list; kept across the list route's unmounts. */
  listOrder: {current: string[] | null};
};

const EMPTY_THREAD: Thread = {loaded: false, synced: false, messages: []};

function toError(error: unknown): TelegramError {
  return error instanceof TelegramError
    ? error
    : new TelegramError('server', error instanceof Error ? error.message : String(error));
}

/** Keeps locally sent messages until Telegram returns them. */
function mergeThread(server: ChatMessage[], previous: ChatMessage[]): ChatMessage[] {
  const known = new Set(server.map(message => message.id));
  const pending = previous.filter(message => message.pending && !known.has(message.id));
  return pending.length === 0 ? server : [...server, ...pending].sort((a, b) => a.timestamp - b.timestamp);
}

function newestIncomingId(messages: ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (!messages[index].fromMe && !messages[index].pending) {
      return messages[index].id;
    }
  }
  return null;
}

export function useChatState(): ChatState {
  const [config, reloadConfig] = useLumenConfig();
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>({kind: 'connecting'});
  const [api, setApi] = useState<ChatApi | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [offline, setOffline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [readMarks, setReadMarks] = useState<ReadMarks>(loadReadMarks);
  const [allowed, setAllowed] = useState<Record<string, AllowedReactions>>({});
  const [avatarVersion, setAvatarVersion] = useState(0);
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;

  const demo = config.status === 'demo';
  const demoRef = useRef(false);
  const activeChatRef = useRef<string | null>(null);
  const markedReadRef = useRef(new Map<string, string>());
  const offlineRef = useRef(false);
  const chatsRef = useRef<Chat[]>([]);
  chatsRef.current = chats;
  const threadsRef = useRef<Record<string, Thread>>({});
  threadsRef.current = threads;
  const listOrderRef = useRef<string[] | null>(null);
  const kickRef = useRef<(chatId?: string) => void>(() => {});

  const account = config.status === 'ready' ? accountKey(config.config) : null;

  const avatars = useMemo(
    () => (api == null ? null : createAvatarLoader(api, () => setAvatarVersion(version => version + 1))),
    [api],
  );
  useEffect(() => () => avatars?.dispose(), [avatars]);
  const media = useMemo(() => (api == null ? null : createMediaLoader(api)), [api]);
  useEffect(() => () => media?.dispose(), [media]);

  const setOfflineState = useCallback((value: boolean) => {
    if (offlineRef.current === value) {
      return;
    }
    offlineRef.current = value;
    setOffline(value);
    if (value) {
      Toast.show(t('connectionLost'));
    }
  }, []);

  const refreshChats = useCallback(async (client: ChatApi, alive: () => boolean) => {
    const next = await client.getChats(CHAT_LIMIT);
    if (alive()) {
      setChats(next);
    }
  }, []);

  const markRead = useCallback((client: ChatApi, chatId: string, messages: ChatMessage[]) => {
    const newest = newestIncomingId(messages);
    const chat = chatsRef.current.find(candidate => candidate.id === chatId);
    const mark = Math.max(
      ...messages.filter(message => !message.fromMe).map(message => message.timestamp),
      chat?.timestamp ?? 0,
    );
    if (mark > 0) {
      setReadMarks(previous => {
        if ((previous[chatId] ?? 0) >= mark) {
          return previous;
        }
        const next = {...previous, [chatId]: mark};
        if (!demoRef.current) {
          saveReadMarks(next);
        }
        return next;
      });
    }
    if (newest == null || markedReadRef.current.get(chatId) === newest) {
      return;
    }
    markedReadRef.current.set(chatId, newest);
    client.markRead(chatId, newest).then(
      () => setChats(previous => previous.map(item => (item.id === chatId ? {...item, unreadCount: 0} : item))),
      () => markedReadRef.current.delete(chatId),
    );
  }, []);

  const refreshThread = useCallback(
    async (client: ChatApi, chatId: string, alive: () => boolean) => {
      const messages = await client.getMessages(chatId, MESSAGE_LIMIT);
      if (!alive()) {
        return;
      }
      setThreads(previous => ({
        ...previous,
        [chatId]: {loaded: true, synced: true, messages: mergeThread(messages, previous[chatId]?.messages ?? [])},
      }));
      const newest = messages[messages.length - 1];
      if (newest) {
        setChats(previous => {
          const chat = previous.find(candidate => candidate.id === chatId);
          if (!chat || (chat.lastMessage?.id === newest.id && chat.lastMessage.reactions === newest.reactions) || (chat.timestamp ?? 0) > newest.timestamp) {
            return previous;
          }
          const updated = {...chat, lastMessage: newest, timestamp: newest.timestamp};
          return chat.lastMessage?.id === newest.id
            ? previous.map(candidate => (candidate.id === chatId ? updated : candidate))
            : [updated, ...previous.filter(candidate => candidate.id !== chatId)];
        });
      }
      if (activeChatRef.current === chatId) {
        markRead(client, chatId, messages);
      }
    },
    [markRead],
  );

  // Connect and load. Network failures retry every 3 s for up to 30 s while
  // the header shows the loading spinner, because the phone's internet may
  // still be coming up. A refused session or API ID stops at once.
  useEffect(() => {
    if (config.status === 'loading') {
      return;
    }
    // Entering demo mode drops the stored read marks from view; leaving it reads them again.
    if (demo !== demoRef.current) {
      demoRef.current = demo;
      setLocaleOverride(demo ? 'en' : null);
      setReadMarks(demo ? {} : loadReadMarks());
    }
    setApi(null);
    setAllowed({});
    markedReadRef.current = new Map();
    offlineRef.current = false;
    setOffline(false);
    if (config.status === 'missing') {
      setChats([]);
      setThreads({});
      setPhase({kind: 'setup', missing: config.missing});
      return;
    }
    if (config.status === 'invalid') {
      setChats([]);
      setThreads({});
      setPhase({kind: 'invalid-config', field: config.field});
      return;
    }

    let alive = true;
    let client: ChatApi | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    // Show the last known chats right away; the header spins until the refresh lands.
    const cached = account ? loadChatCache(account) : null;
    setChats(cached?.chats ?? []);
    setThreads(
      Object.fromEntries(
        Object.entries(cached?.threads ?? {}).map(([chatId, messages]) => [chatId, {loaded: true, synced: false, messages}]),
      ),
    );
    setSyncing(true);
    setPhase(cached ? {kind: 'ready'} : {kind: 'connecting'});

    const attempt = async () => {
      try {
        if (client == null) {
          // Each attempt may use what is left of the 30 s window (at least 8 s).
          const timeoutMs = Math.min(15000, Math.max(8000, CONNECT_WINDOW_MS - (Date.now() - startedAt)));
          const connected = config.status === 'demo' ? createDemoClient() : await connectClient(config.config, {timeoutMs});
          if (!alive) {
            void connected.disconnect();
            return;
          }
          client = connected;
        }
        await refreshChats(client, () => alive);
        if (alive) {
          setApi(client);
          setSyncing(false);
          setPhase({kind: 'ready'});
        }
      } catch (error) {
        if (!alive || isAbortError(error)) {
          return;
        }
        const failure = toError(error);
        if (failure.kind === 'network' && Date.now() - startedAt < CONNECT_WINDOW_MS) {
          timer = setTimeout(attempt, CONNECT_RETRY_MS);
          return;
        }
        setSyncing(false);
        if (cached && failure.kind !== 'auth') {
          // Keep the cached chats on screen; polling keeps retrying.
          if (client) {
            setApi(client);
          }
          setOfflineState(true);
          if (!client) {
            timer = setTimeout(attempt, CONNECT_RETRY_MS * 5);
          }
          return;
        }
        setPhase({kind: 'error', error: failure});
      }
    };
    void attempt();

    return () => {
      alive = false;
      clearTimeout(timer);
      if (client) {
        void client.disconnect();
      }
    };
    // `config` identity changes only when the configuration really changes (sameConfig).
  }, [account, config, connectAttempt, demo, refreshChats, setOfflineState]);

  // Refresh while ready: push updates trigger a refresh of the touched chat
  // and the list; polling (the open conversation every 10 s, the list every
  // 20 s) covers missed updates. Paused while the page is hidden.
  const ready = phase.kind === 'ready' && !syncing && api != null;
  useEffect(() => {
    if (!ready || api == null) {
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let again = false;
    let listDue = 0;

    const schedule = (delay?: number) => {
      clearTimeout(timer);
      if (alive && !document.hidden) {
        timer = setTimeout(run, delay ?? (activeChatRef.current ? THREAD_POLL_MS : LIST_POLL_MS));
      }
    };

    const run = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      const chatId = activeChatRef.current;
      try {
        if (chatId) {
          await refreshThread(api, chatId, () => alive);
        }
        if (!chatId || Date.now() >= listDue) {
          await refreshChats(api, () => alive);
          listDue = Date.now() + LIST_POLL_MS;
        }
        setOfflineState(false);
      } catch (error) {
        if (!alive || isAbortError(error)) {
          return;
        }
        const failure = toError(error);
        if (failure.kind === 'auth') {
          setPhase({kind: 'error', error: failure});
          return;
        }
        if (failure.kind === 'network') {
          setOfflineState(true);
        }
      } finally {
        running = false;
      }
      if (again) {
        again = false;
        schedule(0);
      } else {
        schedule();
      }
    };

    kickRef.current = changedChat => {
      // An update for another chat only changes the list.
      if (changedChat === undefined || changedChat !== activeChatRef.current) {
        listDue = 0;
      }
      schedule(PUSH_REFRESH_MS);
    };
    const unsubscribe = api.onUpdate(update => kickRef.current(update.chatId));

    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
      } else {
        listDue = 0;
        void run();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    listDue = Date.now() + LIST_POLL_MS;
    schedule();

    return () => {
      alive = false;
      clearTimeout(timer);
      unsubscribe();
      kickRef.current = () => {};
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [api, ready, refreshChats, refreshThread, setOfflineState]);

  // Load a thread (and the reactions it accepts) as soon as it opens.
  useEffect(() => {
    if (!ready || api == null || activeChat == null) {
      return;
    }
    let alive = true;
    refreshThread(api, activeChat, () => alive).catch(error => {
      if (!alive || isAbortError(error)) {
        return;
      }
      const failure = toError(error);
      if (failure.kind === 'auth') {
        setPhase({kind: 'error', error: failure});
      } else if (failure.kind === 'network') {
        setOfflineState(true);
      }
    });
    if (!allowedRef.current[activeChat]) {
      api.allowedReactions(activeChat).then(
        value => alive && setAllowed(previous => ({...previous, [activeChat]: value})),
        () => undefined,
      );
    }
    return () => {
      alive = false;
    };
  }, [activeChat, api, ready, refreshThread, setOfflineState]);

  const openThread = useCallback((chatId: string) => {
    activeChatRef.current = chatId;
    setActiveChat(chatId);
    return () => {
      if (activeChatRef.current === chatId) {
        activeChatRef.current = null;
        setActiveChat(null);
      }
    };
  }, []);

  const sendText = useCallback(
    async (chatId: string, text: string, quoted?: ChatMessage | null) => {
      if (api == null) {
        throw new TelegramError('network', 'Not connected');
      }
      const sent = await api.sendText(chatId, text, quoted?.id);
      const message: ChatMessage = {...sent, chatId, pending: true};
      setThreads(previous => {
        const current = previous[chatId] ?? {loaded: true, synced: true, messages: []};
        return {...previous, [chatId]: {...current, messages: mergeThread(current.messages, [message])}};
      });
      setChats(previous => {
        const existing = previous.find(chat => chat.id === chatId);
        if (!existing) {
          return previous;
        }
        const updated = {...existing, lastMessage: message, timestamp: message.timestamp};
        return [updated, ...previous.filter(chat => chat.id !== chatId)];
      });
    },
    [api],
  );

  const sendReaction = useCallback(
    async (message: ChatMessage, emoji: string): Promise<'added' | 'removed'> => {
      if (api == null) {
        throw new TelegramError('network', 'Not connected');
      }
      const current = message.reactions?.find(reaction => reaction.mine);
      const next = current && sameEmoji(current.emoji, emoji) ? null : emoji;
      const apply = (reactions: ReactionSummary[] | undefined) =>
        setThreads(previous => {
          const thread = previous[message.chatId];
          if (!thread) {
            return previous;
          }
          return {
            ...previous,
            [message.chatId]: {
              ...thread,
              messages: thread.messages.map(item => {
                if (item.id !== message.id) {
                  return item;
                }
                const {reactions: _old, ...rest} = item;
                return reactions?.length ? {...rest, reactions} : rest;
              }),
            },
          };
        });
      // Show the badge now; Telegram's answer replaces it.
      apply(withMyReaction(message.reactions, next));
      try {
        apply(await api.sendReaction(message.chatId, message.id, next));
      } catch (error) {
        apply(message.reactions);
        throw error;
      }
      return next ? 'added' : 'removed';
    },
    [api],
  );

  const loadMedia = useCallback(
    (message: ChatMessage) =>
      media == null ? Promise.reject(new TelegramError('network', 'Not connected')) : media.load(message),
    [media],
  );

  // Persist the list and recent messages for an instant start next time.
  useEffect(() => {
    if (account == null || phase.kind !== 'ready' || syncing || chats.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      const messages: Record<string, ChatMessage[]> = {};
      for (const [chatId, thread] of Object.entries(threads)) {
        if (thread.loaded) {
          messages[chatId] = thread.messages;
        }
      }
      saveChatCache(account, chats, messages);
    }, 300);
    return () => clearTimeout(timer);
  }, [account, chats, phase.kind, syncing, threads]);

  const isUnread = useCallback(
    (chat: Chat) => chat.unreadCount > 0 && chat.id !== activeChat && (chat.timestamp ?? 0) > (readMarks[chat.id] ?? 0),
    [activeChat, readMarks],
  );

  return useMemo<ChatState>(
    () => ({
      phase,
      chats,
      offline,
      syncing,
      isUnread,
      thread: chatId => threads[chatId] ?? EMPTY_THREAD,
      chatFor: chatId => chats.find(chat => chat.id === chatId),
      retry: () => setConnectAttempt(count => count + 1),
      reloadConfig: () => {
        void reloadConfig().then(next => {
          if (next.status === 'missing') {
            Toast.show(t('setupStillMissing'));
          }
        });
      },
      openThread,
      sendText,
      sendReaction,
      allowedReactions: chatId => allowed[chatId] ?? null,
      avatarFor: chatId => avatars?.get(chatId) ?? null,
      requestAvatar: chat => {
        if (chat?.hasPhoto) {
          avatars?.request(chat.id, chat.photoKey ?? 'photo');
        }
      },
      loadMedia,
      listOrder: listOrderRef,
    }),
    // avatarVersion: a photo finished loading.
    [allowed, avatarVersion, avatars, chats, isUnread, loadMedia, offline, openThread, phase, reloadConfig, sendReaction, sendText, syncing, threads],
  );
}
