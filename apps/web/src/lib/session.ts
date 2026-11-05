import "server-only";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { env } from "./env";
import { SESSION_COOKIE_NAME } from "./session-cookie";

export type SessionData = {
  loggedInAt?: number;
  /** SHA-256 of the admin password hash this session was issued for (see `isSessionValid` in auth.ts). */
  credentialTag?: string;
};

export { SESSION_COOKIE_NAME };

function sessionOptions(): SessionOptions {
  return {
    cookieName: SESSION_COOKIE_NAME,
    password: env.SESSION_SECRET,
    ttl: env.SESSION_TTL_SEC,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.COOKIE_SECURE,
      path: "/",
    },
  };
}

/** iron-session bound to the request cookies. `save()`/`destroy()` only work in server actions / route handlers. */
export async function getSession(): Promise<IronSession<SessionData>> {
  // cookies() first: during prerender it bails out to dynamic rendering before env is touched.
  const store = await cookies();
  return getIronSession<SessionData>(store, sessionOptions());
}
