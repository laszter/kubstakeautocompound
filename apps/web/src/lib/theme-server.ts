import "server-only";
import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE, type Theme } from "./theme";

/** Theme preference from the (non-httpOnly, client-written) `theme` cookie, whitelisted by parseTheme. */
export async function getTheme(): Promise<Theme> {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}
