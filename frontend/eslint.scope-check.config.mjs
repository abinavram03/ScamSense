// Temporary config: catch undefined identifiers that the build lets through.
import js from "@eslint/js";
import react from "eslint-plugin-react";

export default [
  {
    files: ["**/*.jsx"],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: "readonly", document: "readonly", navigator: "readonly",
        localStorage: "readonly", console: "readonly", fetch: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly",
        setInterval: "readonly", clearInterval: "readonly",
        FileReader: "readonly", FormData: "readonly", Blob: "readonly",
        File: "readonly", requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly", Image: "readonly",
        URL: "readonly", confirm: "readonly", alert: "readonly",
      },
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...js.configs.recommended.rules,
      "no-undef": "error",
      "no-unused-vars": ["warn", { varsIgnorePattern: "^[A-Z_]", args: "none" }],
    },
  },
];