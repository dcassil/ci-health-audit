import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Strict ESLint flat config for ci-health-audit.
 *
 * NFR-003: no escape hatches. `any` is forbidden, and the codebase must contain
 * zero inline `eslint-disable` / `ts-ignore` / `ts-expect-error`. Rules are not
 * loosened to make code pass — code is fixed instead.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '**/*.d.ts'],
  },

  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ---- File size & complexity ----
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      complexity: ['warn', { max: 12 }],
      'max-depth': ['warn', 4],
      'max-params': ['warn', 5],

      // ---- Type safety (no escape hatches) ----
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // ---- No re-export barrels: export explicitly ----
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportAllDeclaration',
          message: 'Re-exports (export * from) are not allowed. Export explicitly.',
        },
      ],

      // ---- General quality ----
      'no-console': 'error',
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': ['error', 'always'],
      'prefer-template': 'error',
    },
  },

  // Tests: canned tool output is intentionally loosely typed, and console/logging
  // is fine in test scaffolding. `any` remains forbidden — tests must be honest too.
  {
    files: ['test/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    rules: {
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
      'no-console': 'off',
    },
  },
);
