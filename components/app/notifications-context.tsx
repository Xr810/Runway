"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { readJson } from "@/lib/api-response";

export type Notice = {
  id: string;
  seq: string;
  actor: string;
  action: string;
  summary: string;
  entryId: string | null;
  title: string;
  organization: string;
  created: string;
  read: boolean;
  dismissed: boolean;
  source: { kind: string; id: string; subject: string; url: string; occurredAt: string };
  changes: { field: string; before: unknown; after: unknown }[];
};
export type NoticeFeed = {
  items: Notice[];
  unread: number;
  latest: string;
  nextBefore: string | null;
};

type NotificationsContextValue = {
  notifications: NoticeFeed;
  notificationsError: string;
  notificationsOpen: boolean;
  setNotificationsOpen: (open: boolean) => void;
  refreshNotifications: () => Promise<void>;
};
const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function useNotifications() {
  const value = useContext(NotificationsContext);
  if (!value) throw Error("useNotifications outside DeskProvider");
  return value;
}

export function NotificationsProvider({
  children,
  onChanged,
  onFocus,
}: {
  children: ReactNode;
  onChanged: () => Promise<void>;
  onFocus: () => Promise<void>;
}) {
  const [notifications, setNotifications] = useState<NoticeFeed>({
    items: [],
    unread: 0,
    latest: "0",
    nextBefore: null,
  });
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const latest = useRef<string | null>(null);
  const refreshNotifications = useCallback(async () => {
    try {
      const next = await readJson<NoticeFeed>(
        await fetch("/api/notifications?history=false", { cache: "no-store" }),
      );
      if (latest.current !== null && latest.current !== next.latest) void onChanged();
      latest.current = next.latest;
      setNotifications(next);
      setNotificationsError("");
    } catch (error) {
      setNotificationsError((error as Error).message);
    }
  }, [onChanged]);
  useEffect(() => {
    void Promise.resolve().then(refreshNotifications);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshNotifications();
    }, 30000);
    const focus = () => {
      void refreshNotifications();
      void onFocus();
    };
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [refreshNotifications, onFocus]);
  const value = useMemo(
    () => ({
      notifications,
      notificationsError,
      notificationsOpen,
      setNotificationsOpen,
      refreshNotifications,
    }),
    [notifications, notificationsError, notificationsOpen, refreshNotifications],
  );
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
