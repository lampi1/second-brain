import tseslint from 'typescript-eslint';

export default tseslint.config(
  // brain-template/: the files a new user's brain starts from (plain Node scripts and page code run in the brain, not in
  // the app), checked by test/unit/brain-template.test.ts (every script parses, nothing personal), not by these rules
  { ignores: ['out/**', 'node_modules/**', 'test-results/**', 'docs/**', 'brain-template/**', 'scripts/shot.cjs', 'scripts/make-icon.cjs'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'off',
    },
  },
  // Process boundaries: the renderer never imports main/preload code or Node built-ins; main never imports the renderer.
  {
    files: ['src/renderer/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['**/main/**', '**/preload/**', 'node:*', 'electron'] }] },
  },
  {
    files: ['src/main/**', 'src/preload/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['**/renderer/**'] }] },
  },
);
