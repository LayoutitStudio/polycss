import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: true },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "no-duplicate-imports": "error",
      "no-console": "warn",
      eqeqeq: "error",
      "prefer-const": "error",
    },
  },
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        "document",
        "window",
        "navigator",
        "location",
        "getComputedStyle",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "Blob",
        "Image",
        "HTMLElement",
        "Element",
        "Option",
      ],
    },
  },
];
