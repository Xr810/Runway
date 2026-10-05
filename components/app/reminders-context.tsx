"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { today } from "@/lib/model";
import type { Reminder } from "@/lib/reminder-schema";
import { readJson } from "@/lib/api-response";

export type ReminderItem = Reminder & { description: string };
export type Reminders = { reminders: ReminderItem[]; today: (ReminderItem & { done: boolean })[] };

type RemindersContextValue = { reminders: Reminders; reloadReminders: () => Promise<void> };
const RemindersContext = createContext<RemindersContextValue | null>(null);

export function useReminders() {
  const value = useContext(RemindersContext);
  if (!value) throw Error("useReminders outside DeskProvider");
  return value;
}

export function RemindersProvider({ children }: { children: ReactNode }) {
  const [reminders, setReminders] = useState<Reminders>({ reminders: [], today: [] });
  const reloadReminders = useCallback(async () => {
    try {
      setReminders(
        await readJson<Reminders>(
          await fetch("/api/reminders?day=" + today(), { cache: "no-store" }),
        ),
      );
    } catch {
      /* the Today page shows its own error state */
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(reloadReminders);
  }, [reloadReminders]);
  const value = useMemo(() => ({ reminders, reloadReminders }), [reminders, reloadReminders]);
  return <RemindersContext.Provider value={value}>{children}</RemindersContext.Provider>;
}
