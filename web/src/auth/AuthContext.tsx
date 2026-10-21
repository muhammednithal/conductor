import { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { setToken } from "../api/client";

const TOKEN_KEY = "conductor_token";

interface AuthCtx { token: string | null; login: (t: string) => void; logout: () => void; }
const Ctx = createContext<AuthCtx>({ token: null, login: () => {}, logout: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  // Initialise from localStorage so token survives page refresh
  const [token, setLocalToken] = useState<string | null>(() => {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) setToken(saved); // sync the API client immediately
    return saved;
  });

  const login = (t: string) => {
    localStorage.setItem(TOKEN_KEY, t);
    setToken(t);
    setLocalToken(t);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setLocalToken(null);
  };

  return <Ctx.Provider value={{ token, login, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);