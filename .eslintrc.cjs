// ESLint 8 + eslintrc (kept deliberately — a flat-config + typescript-eslint v8
// migration is a separate, larger change). `npm run lint` fails on ERRORS only;
// the ~270 react-hooks/exhaustive-deps warnings are a known backlog to burn down.
// Ratchet plan: re-enable no-unused-vars (warn -> error), then no-explicit-any.
module.exports = {
  root: true,
  env: { browser: true, es6: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh', 'unused-imports'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // Unused imports are always safe to strip and are auto-fixable, so they are
    // an error (CI-blocking). Unused locals/params are surfaced as warnings;
    // `_`-prefixed names are intentional. Next ratchet: no-unused-vars -> error.
    "@typescript-eslint/no-unused-vars": "off",
    "unused-imports/no-unused-imports": "error",
    "unused-imports/no-unused-vars": [
      "warn",
      {
        vars: "all",
        varsIgnorePattern: "^_",
        args: "after-used",
        argsIgnorePattern: "^_",
        caughtErrors: "all",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
    // ~1000 occurrences; a dedicated cleanup, then flip to "warn".
    "@typescript-eslint/no-explicit-any": "off",
    "no-useless-catch": "off",
    "no-unused-vars": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/no-var-requires": "off"
  },
}
