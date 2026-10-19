import { createContext, useContext, useState, ReactNode } from "react";
import { setToken } from "../api/client";

interface AuthCtx { token: string | null; login: (t: string) => void; logout: () => void; }
const Ctx = createContext<AuthCtx>({ token: null, login: () => {}, logout: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setLocalToken] = useState<string | null>(null);
  const login = (t: string) => { setLocalToken(t); setToken(t); };
  const logout = () => { setLocalToken(null); setToken(null); };
  return <Ctx.Provider value={{ token, login, logout }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);