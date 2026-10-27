export interface Session {
  userId: string;
  role: "admin" | "clerk";
}

export function getSession(token: string): Session | null {
  if (!token) return null;
  return { userId: "user-1", role: "clerk" };
}
