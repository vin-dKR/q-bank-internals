// Flat ESLint config. These rules are the machine-enforced subset of CONVENTIONS.md.
// If a rule here disagrees with the doc, the doc wins and this file is out of date — fix it.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      'contracts/**',
      '**/scripts/**',
      '**/.claude/**',
      '*.config.mjs',
      '*.config.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // §8 — honest types
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',

      // §9 — no slop
      'no-console': 'error',
      'no-debugger': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CatchClause[body.body.length=0]',
          message: '§7: empty catch is forbidden — handle the error or let it propagate.',
        },
      ],
    },
  },
);
