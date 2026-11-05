// Boot-time env check (TASK §Security model: MASTER_KEY etc. invalid → refuse to start).
// Node-only code lives in lib/boot-check.ts so it stays out of the edge bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertWebEnvAtBoot } = await import("./lib/boot-check");
    assertWebEnvAtBoot();
  }
}
