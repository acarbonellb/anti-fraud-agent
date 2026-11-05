// What a linter can check lives here; what needs judgement lives in
// CODING_STANDARDS.md.
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules", "dist", "coverage"] },
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // env-var skill: env is read once, in the config module, and validated.
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Read configuration through src/config, not process.env.",
        },
      ],
    },
  },
  {
    // Entry points hand process.env to loadConfig; nothing else reads it.
    files: ["src/config/**", "*.config.ts", "scripts/**"],
    rules: { "no-restricted-properties": "off" },
  },
  {
    // Test doubles stay out of the deployed image (.dockerignore): only tests
    // and other doubles may import them.
    files: ["src/**/*.ts", "scripts/**/*.ts"],
    ignores: ["**/*.test.ts", "src/test-support/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/test-support/**"],
              message: "Test doubles are for tests only.",
            },
          ],
        },
      ],
    },
  },
  {
    // Tooling configs aren't in tsconfig: lint them without type information.
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
