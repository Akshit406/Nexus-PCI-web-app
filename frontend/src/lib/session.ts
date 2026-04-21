export type SessionUser = {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  mustChangePassword: boolean;
  clientId?: string;
};

const TOKEN_KEY = "pci-nexus-token";
const USER_KEY = "pci-nexus-user";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getStoredUser(): SessionUser | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

export function setStoredUser(user: SessionUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredUser() {
  localStorage.removeItem(USER_KEY);
}

export function clearSession() {
  clearToken();
  clearStoredUser();
}
