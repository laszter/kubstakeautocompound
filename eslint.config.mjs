// Root ESLint flat config: packages/* + apps/worker.
// apps/web has its own config (eslint-config-next) and is linted via `npm run lint -w @kubstake/web`.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "apps/web/**",
      "**/dist/**",
      "**/.next/**",
      "**/drizzle/**",
      "**/coverage/**",
      "**/node_modules/**",
    ],
  },
  ...tseslint.configs.recommended,
);
