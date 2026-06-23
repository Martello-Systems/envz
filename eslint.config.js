import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    files: ["bin/**/*.js", "src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
    },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  {
    // React (TUI) files use the JSX-free createElement API; React is imported.
    files: ["src/tui/**/*.js"],
    languageOptions: {
      globals: { setTimeout: "readonly" },
    },
  },
];
