"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type NavigationGuardContextValue = {
  guard: string | null;
  setGuard: (message: string | null) => void;
  confirmLeave: () => boolean;
};
const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);

export function useNavigationGuard() {
  const value = useContext(NavigationGuardContext);
  if (!value) throw Error("useNavigationGuard outside DeskProvider");
  return value;
}

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const [guard, setGuard] = useState<string | null>(null);
  const confirmLeave = useCallback(() => !guard || window.confirm(guard), [guard]);
  const value = useMemo(() => ({ guard, setGuard, confirmLeave }), [guard, confirmLeave]);
  return (
    <NavigationGuardContext.Provider value={value}>{children}</NavigationGuardContext.Provider>
  );
}
