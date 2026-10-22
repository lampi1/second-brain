// The two-word gist of a command or tool call (shared/gist.ts): known programs map to one gist, a chain is read past
// its set-up steps, a description gives a gist only when it names a known action, the rest falls back to a generic one;
// every gist has its two words in each language.
import { describe, expect, it } from 'vitest';
import { commandGist, describedGist, gistOf, type Gist } from '../../src/shared/gist';
import { it as italian } from '../../src/renderer/i18n/it';
import { en } from '../../src/renderer/i18n/en';
import { de } from '../../src/renderer/i18n/de';

describe('commandGist', () => {
  const cases: [string, Gist | null][] = [
    ['npm test', 'tests'],
    ['npx vitest run test/unit', 'tests'],
    ['npm run test:e2e', 'tests'],
    ['pnpm run check', 'tests'],
    ['python -m pytest -q', 'tests'],
    ['go test ./...', 'tests'],
    ['dotnet test', 'tests'],
    ['npm install --save-exact left-pad', 'install'],
    ['npm ci', 'install'],
    ['pip install -r requirements.txt', 'install'],
    ['winget install Git.Git', 'install'],
    ['npm run build', 'build'],
    ['cargo build --release', 'build'],
    ['npx tsc --noEmit -p .', 'lint'],
    ['npx eslint src', 'lint'],
    ['npx prettier --write .', 'format'],
    ['git push -u origin feat/x', 'push'],
    ['git commit -m "x"', 'commit'],
    ['git pull --ff-only', 'pull'],
    ['git checkout -b feat/x', 'branch'],
    ['git branch -D old', 'delete'],
    ['git reset --hard HEAD~1', 'gitUndo'],
    ['git status', 'diff'],
    ['git log --oneline -5', 'history'],
    ['gh pr create --fill', 'pr'],
    ['rm -rf dist', 'delete'],
    ['Remove-Item -Recurse .\\out', 'delete'],
    ['del /q build\\*.obj', 'delete'],
    ['mv a.txt b.txt', 'move'],
    ['Copy-Item a b', 'copy'],
    ['mkdir -p out/logs', 'mkdir'],
    ['Get-ChildItem -Recurse', 'list'],
    ['cat package.json', 'read'],
    ['rg TODO src', 'search'],
    ['curl -s https://example.com', 'web'],
    ['docker compose up -d', 'container'],
    ['taskkill /F /IM electron.exe', 'kill'],
    ['node scripts/release.mjs', 'script'],
    ['C:\\tools\\npm.cmd test', 'tests'],
  ];
  it.each(cases)('%s → %s', (cmd, gist) => expect(commandGist(cmd)).toBe(gist));

  it('reads a chain past its set-up steps and leading variables', () => {
    expect(commandGist('cd app && npm test')).toBe('tests');
    expect(commandGist('Set-Location C:\\repo; git push')).toBe('push');
    expect(commandGist('CI=1 FORCE_COLOR=0 npm run build')).toBe('build');
    expect(commandGist('export NODE_ENV=test\nnpm test')).toBe('tests');
    expect(commandGist('$env:DEBUG="1"; npm ci')).toBe('install');
    expect(commandGist('cd C:\\repo')).toBe('cd');
  });

  it('a pipe is the left side, a comment line is skipped', () => {
    expect(commandGist('npm test 2>&1 | tail -20')).toBe('tests');
    expect(commandGist('# install first\nnpm ci')).toBe('install');
  });

  it('an unknown first step gives no gist (never the next step\'s)', () => {
    expect(commandGist('frobnicate --all && npm test')).toBeNull();
    expect(commandGist('')).toBeNull();
  });
});

describe('describedGist', () => {
  it('only a known action named in the description', () => {
    expect(describedGist('Run the unit tests')).toBe('tests');
    expect(describedGist('Esegue i test della pagina')).toBe('tests');
    expect(describedGist('Install dependencies')).toBe('install');
    expect(describedGist('Push the branch to origin')).toBe('push');
    expect(describedGist('Delete the temp folder')).toBe('delete');
    expect(describedGist('Show the weather')).toBeNull();
  });
});

describe('gistOf', () => {
  it('a shell permission: the command first, then the description, then the generic one', () => {
    expect(gistOf('Bash', { command: 'npm test', description: 'Delete everything' })).toBe('tests');
    expect(gistOf('Bash', { command: './weird-tool --go', description: 'Run the tests in watch mode' })).toBe('tests');
    expect(gistOf('PowerShell', { command: './weird-tool --go', description: 'Checks the weather' })).toBe('command');
    expect(gistOf('Shell', { command: 'git push' })).toBe('push');
  });
  it('a command card: its code', () => {
    expect(gistOf('command', {}, 'npm install')).toBe('install');
    expect(gistOf('command', {}, 'something odd')).toBe('command');
  });
  it('file and web tools, MCP tools, unknown tools', () => {
    expect(gistOf('Read', { file_path: 'a.md' })).toBe('read');
    expect(gistOf('Edit', { file_path: 'a.md' })).toBe('edit');
    expect(gistOf('Write', { file_path: 'a.md' })).toBe('write');
    expect(gistOf('WebFetch', { url: 'https://x.y' })).toBe('openPage');
    expect(gistOf('mcp__second-brain__browser_navigate', { url: 'https://x.y' })).toBe('openPage');
    expect(gistOf('mcp__second-brain__agent_delegate', {})).toBe('delegate');
    expect(gistOf('mcp__team-devops__wit_get_work_item', {})).toBe('readData');
    expect(gistOf('mcp__team-devops__wit_update_work_item', {})).toBe('changeData');
    expect(gistOf('mcp__claude_ai_Gmail__send_message', {})).toBe('send');
    expect(gistOf('mcp__x__ping', {})).toBe('connector');
    expect(gistOf('SomethingNew', {})).toBe('tool');
  });
});

describe('the words', () => {
  const ids = Object.keys(italian).filter(k => k.startsWith('genui.gist.'));
  it('every gist is two words in each language', () => {
    expect(ids.length).toBeGreaterThan(40);
    for (const d of [italian, en, de] as Record<string, unknown>[]) {
      for (const k of ids) expect(String(d[k]).trim().split(/\s+/), `${k}`).toHaveLength(2);
    }
  });
  it('the owner\'s examples', () => {
    const w = italian as Record<string, unknown>;
    expect(w['genui.gist.tests']).toBe('Esegue test');
    expect(w['genui.gist.install']).toBe('Installa pacchetti');
    expect(w['genui.gist.push']).toBe('Pubblica branch');
    expect(w['genui.gist.delete']).toBe('Cancella file');
  });
});
