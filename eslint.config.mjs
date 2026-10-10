import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'packages/backend/generated/**',
      'eslint.config.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript already reports undefined identifiers; the core no-undef rule
      // is redundant on TS and misfires on Node/DOM globals (disabling it is
      // typescript-eslint's own recommendation).
      'no-undef': 'off',
      // Existing debt (~80 occurrences across API payloads and bot-flow configs);
      // re-enable once payloads are typed from @ts6/common.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // `catch { /* why it is safe to ignore */ }` is used pervasively
      'no-empty': ['error', { allowEmptyCatch: true }],
      // `declare global { namespace Express ... }` request augmentation
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
    },
  },
  {
    files: ['packages/backend/**/*.ts', 'packages/common/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/frontend/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Real signal but refactor-level — keep visible without failing CI
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/incompatible-library': 'warn',
    },
    languageOptions: { globals: globals.browser },
  },
);
