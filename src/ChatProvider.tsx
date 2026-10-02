import {createContext, useContext, type ReactNode} from 'react';
import {useChatState, type ChatState} from './state/useChatState';

export type {Phase, Thread} from './state/useChatState';

const ChatContext = createContext<ChatState | null>(null);

/** Durable connection, chat, and thread state; lives outside the route transition. */
export function ChatProvider({children}: {children: ReactNode}) {
  const state = useChatState();
  return <ChatContext.Provider value={state}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatState {
  const context = useContext(ChatContext);
  if (context == null) {
    throw new Error('useChat must be used within ChatProvider');
  }
  return context;
}
