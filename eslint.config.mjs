import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", "playwright-report/**", "test-results/**", "next-env.d.ts"],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "no-console": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // Event handlers are routinely async in React; the promise is handled by the handler itself.
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/require-await": "off",
    },
  },

  // React app code
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y, "@next/next": nextPlugin },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // Autofocus on the first field of a dialog is deliberate; the rule only matters for raw DOM elements.
      "jsx-a11y/no-autofocus": ["error", { ignoreNonDOM: true }],
      // Radix Switch/Checkbox render buttons the rule cannot see through.
      "jsx-a11y/label-has-associated-control": [
        "error",
        { controlComponents: ["Switch", "Checkbox", "Input", "Select", "Textarea"], depth: 3 },
      ],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Plain JavaScript entry points are outside the TypeScript project.
  { files: ["**/*.mjs"], ...tseslint.configs.disableTypeChecked },

  // Tests and the browser-test harness talk to loosely typed JSON; keep them readable rather than cast-heavy.
  {
    files: ["**/*.test.{ts,tsx}", "e2e/**/*.ts", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",
    },
  },

  // Command-line entry points may print.
  { files: ["scripts/**", "playwright.config.ts"], rules: { "no-console": "off" } },
);
