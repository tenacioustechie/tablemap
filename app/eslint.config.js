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
    // Player view is render-only and must never pull in DM UI or the DM store.
    // Tests are exempt: they need a DM store to drive the player under test.
    files: ["src/player/**"],
    ignores: ["src/player/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/dm", "**/dm/**", "*dm/*"],
              message: "src/player must not import from src/dm.",
            },
            {
              group: ["**/state/store", "**/state/dmSync"],
              message:
                "src/player is render-only: read the sync mirror, never the DM store.",
            },
          ],
        },
      ],
    },
  }
);
