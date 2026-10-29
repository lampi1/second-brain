// ESLint for the whole repo (`npm run lint`, and the changed files in `npm run check:branch`): typescript-eslint on
// TypeScript 6 (ADR 0198), process boundaries, and the repo rules with their remediation (file header, size; see
// docs/agents/rules.md).
import tseslint from 'typescript-eslint';

/** Files over MAX_LINES today (2026-10-29): known debt, being split by another task; a new file over it warns. */
const LONG_FILES = [
  'src/main/browser/actions.ts', 'src/main/chats/acp.ts', 'src/main/chats/claude.ts', 'src/main/chats/codex.ts',
  'src/main/demo.ts', 'src/main/wiring.ts', 'src/renderer/brain/map/engine.ts',
  'src/shared/concept-guide.ts', 'test/unit/agents/delegation.test.ts',
];
const MAX_LINES = 800;

// The repo rules a lint can check, each failing with the fix to make (docs/agents/rules.md).
const sb = {
  rules: {
    // AGENTS.md rule 10: every file starts with a header comment (what, why, who uses it)
    'file-header': {
      meta: { type: 'suggestion', schema: [] },
      create: context => ({
        Program(node) {
          const text = context.sourceCode.text.replace(/^#!.*\n/, '').trimStart();
          if (text.startsWith('//') || text.startsWith('/*')) return;
          context.report({ node, loc: { line: 1, column: 0 }, message: 'This file has no header comment. Fix: start it with a // comment saying what it does, why, and who uses it (AGENTS.md rule 10, docs/agents/rules.md).' });
        },
      }),
    },
    // a file over MAX_LINES does several jobs: a warning only, never a failed build
    'max-lines': {
      meta: { type: 'suggestion', schema: [] },
      create: context => ({
        Program(node) {
          const lines = context.sourceCode.lines.length;
          if (lines <= MAX_LINES) return;
          context.report({ node, loc: { line: 1, column: 0 }, message: `This file has ${lines} lines (max ${MAX_LINES}). Fix: split it by responsibility into modules beside it, each with its own header and tests (docs/agents/rules.md).` });
        },
      }),
    },
  },
};

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
  { plugins: { sb }, rules: { 'sb/file-header': 'error', 'sb/max-lines': 'warn' } },
  { files: LONG_FILES, rules: { 'sb/max-lines': 'off' } },
  // Process boundaries: the renderer never imports main/preload code or Node built-ins; main never imports the renderer.
  {
    files: ['src/renderer/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['**/main/**', '**/preload/**', 'node:*', 'electron'] }] },
  },
  {
    files: ['src/main/**', 'src/preload/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['**/renderer/**'] }] },
  },
  // The shared routine runtime (ADR 0175) runs in the app and in a terminal CLI: never Electron, the main process or the
  // renderer; the host gives it ports (test/unit/routine-runtime/boundary.test.ts checks the same on every file).
  {
    files: ['packages/routine-runtime/**'],
    rules: { 'no-restricted-imports': ['error', { paths: ['electron'], patterns: ['electron/*', '**/src/main/**', '**/main/**', '**/renderer/**', '**/preload/**'] }] },
  },
);
