"use client";

import { createContext, useContext, type ReactNode } from "react";

type ChatChromeContextValue = {
  enabled: boolean;
  open: boolean;
  unreadCount: number;
  onToggle: () => void;
};

const ChatChromeContext = createContext<ChatChromeContextValue>({
  enabled: false,
  open: false,
  unreadCount: 0,
  onToggle: () => undefined,
});

export function ChatChromeProvider({ children, ...value }: ChatChromeContextValue & { children: ReactNode }) {
  return <ChatChromeContext.Provider value={value}>{children}</ChatChromeContext.Provider>;
}

export function HeaderChatButton({ inGame = false }: { inGame?: boolean }) {
  const { enabled, open, unreadCount, onToggle } = useContext(ChatChromeContext);
  if (!enabled) return null;

  return (
    <button
      className={`header-chat ${inGame ? "game-header-chat" : ""} ${open ? "active" : ""}`}
      onClick={onToggle}
      aria-label={`${open ? "Close" : "Open"} friends chat${unreadCount ? `, ${unreadCount} unread` : ""}`}
      aria-expanded={open}
    >
      <span className="header-chat-icon" aria-hidden="true">話</span>
      {unreadCount > 0 && <em>{unreadCount > 9 ? "9+" : unreadCount}</em>}
    </button>
  );
}
