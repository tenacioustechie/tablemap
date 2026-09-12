import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "playwright-report", "test-results"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": ["warn"],
    },
  },
  {
    // Player view is render-only and must never pull in DM UI.
    files: ["src/player/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/dm", "**/dm/**", "*dm/*"],
              message: "src/player must not import from src/dm.",
            },
          ],
        },
      ],
    },
  }
);
