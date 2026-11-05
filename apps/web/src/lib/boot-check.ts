import { loadWebEnv } from "@kubstake/core";

/**
 * Validates the web env when the Next server starts and exits(1) if it is invalid. Skipped during
 * `next build` so images can be built without secrets (src/lib/env.ts stays lazy for the same reason).
 */
export function assertWebEnvAtBoot(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    loadWebEnv();
  } catch (err) {
    // loadWebEnv's message lists variable names + reasons only, never values.
    console.error(`[web] ${err instanceof Error ? err.message : String(err)}\n[web] refusing to start`);
    process.exit(1);
  }
}
