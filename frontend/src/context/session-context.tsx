import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import {
  clearSession,
  getStoredUser,
  getToken,
  SessionUser,
  setStoredUser,
  setToken,
} from "../lib/session";

type SessionContextValue = {
  token: string | null;
  user: SessionUser | null;
  isAuthenticated: boolean;
  setSession: (nextToken: string, nextUser: SessionUser) => void;
  updateUser: (nextUser: SessionUser) => void;
  signOut: () => void;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);
const LAST_ACTIVITY_KEY = "pci-nexus-last-activity";
const IDLE_TIMEOUT_MS = Number(import.meta.env.VITE_IDLE_TIMEOUT_MS ?? 30 * 60 * 1000);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [tokenState, setTokenState] = useState<string | null>(() => getToken());
  const [userState, setUserState] = useState<SessionUser | null>(() => getStoredUser());

  useEffect(() => {
    if (!tokenState || !userState) {
      localStorage.removeItem(LAST_ACTIVITY_KEY);
      return;
    }

    const markActivity = () => {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    };

    const lastActivity = Number(localStorage.getItem(LAST_ACTIVITY_KEY) ?? 0);
    if (lastActivity && Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
      clearSession();
      setTokenState(null);
      setUserState(null);
      localStorage.removeItem(LAST_ACTIVITY_KEY);
      return;
    }

    markActivity();
    const events: Array<keyof WindowEventMap> = ["click", "keydown", "mousemove", "scroll", "touchstart"];
    events.forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }));

    const interval = window.setInterval(() => {
      const currentLastActivity = Number(localStorage.getItem(LAST_ACTIVITY_KEY) ?? 0);
      if (currentLastActivity && Date.now() - currentLastActivity > IDLE_TIMEOUT_MS) {
        clearSession();
        setTokenState(null);
        setUserState(null);
        localStorage.removeItem(LAST_ACTIVITY_KEY);
      }
    }, 60_000);

    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, markActivity));
      window.clearInterval(interval);
    };
  }, [tokenState, userState]);

  const value = useMemo<SessionContextValue>(
    () => ({
      token: tokenState,
      user: userState,
      isAuthenticated: Boolean(tokenState && userState),
      setSession(nextToken, nextUser) {
        setToken(nextToken);
        setStoredUser(nextUser);
        setTokenState(nextToken);
        setUserState(nextUser);
      },
      updateUser(nextUser) {
        setStoredUser(nextUser);
        setUserState(nextUser);
      },
      signOut() {
        clearSession();
        setTokenState(null);
        setUserState(null);
        localStorage.removeItem(LAST_ACTIVITY_KEY);
      },
    }),
    [tokenState, userState],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside SessionProvider.");
  }

  return context;
}
