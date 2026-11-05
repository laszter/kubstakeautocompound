"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the current route's server components every `intervalMs` while the tab is visible. */
export function AutoRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer === undefined) timer = setInterval(() => router.refresh(), intervalMs);
    };
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        router.refresh(); // catch up immediately after the tab comes back
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, intervalMs]);

  return null;
}
