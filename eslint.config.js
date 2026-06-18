// Root ESLint flat config — shared by all non-dashboard packages.
// Dashboard uses its own eslint.config.mjs (Next.js preset).

import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

/** @type {import("eslint").Linter.Config[]} */
export default [
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // TypeScript-specific: no unused vars.
      // Turn off the base rule — @typescript-eslint/no-unused-vars handles TS correctly.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          // Interface/type parameter names are not "used" in JS terms — ignore them.
          ignoreRestSiblings: true,
          caughtErrors: "none",
        },
      ],
      // Allow explicit `any` only where necessary
      "@typescript-eslint/no-explicit-any": "warn",
      // No console.log in production code
      "no-console": "warn",
      // Standard JS rules
      "no-undef": "off", // TypeScript handles this better
    },
  },
  {
    // Test files: relax some rules
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },
];
