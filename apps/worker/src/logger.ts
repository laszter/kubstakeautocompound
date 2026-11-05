import pino, { type DestinationStream, type Logger } from "pino";

// JSON logs to stdout only. No pino.transport / pino-pretty here (worker threads do not survive bundling);
// read them pretty with: docker compose logs -f --no-log-prefix worker | npx pino-pretty
// (--no-log-prefix is required: the "worker-1 |" prefix makes the line non-JSON and pino-pretty passes it through)

/** TASK §Security model — never log key material, ciphertext, passwords or the master key. */
export const REDACT_PATHS = [
  "privateKey",
  "*.privateKey",
  "encryptedKey",
  "*.encryptedKey",
  "password",
  "*.password",
  "masterKey",
  "MASTER_KEY",
  "req.headers.cookie",
  "req.headers.authorization",
];

export type { Logger };

export function createLogger(
  level: string = "info",
  opts: { name?: string; destination?: DestinationStream } = {},
): Logger {
  return pino(
    {
      level,
      base: { service: opts.name ?? "worker" },
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    },
    // sync stdout writes: low volume, and nothing is lost on process.exit()
    opts.destination ?? pino.destination({ dest: 1, sync: true }),
  );
}
