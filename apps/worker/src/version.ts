import pkg from "../package.json";

/** Worker version (from apps/worker/package.json; inlined by esbuild at build time). */
export const WORKER_VERSION: string = pkg.version;
