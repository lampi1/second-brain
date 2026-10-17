// "Domande in finestra" stays on once the user turns it on (the user, 2026-10-16: "li voglio sempre a modale se ho
// settato l'impostazione. È come se a volte si togliesse da sola"): an agent cannot turn it off (protected key: a
// proposal, the value stays), and only the deliberate switches (Settings, the top bar switch, Ctrl+K) change it. The
// questions window itself has no off button any more: one in its head, under the pointer when the window popped up,
// turned it off by mistake (stable changes.jsonl: each "off" seconds after a request appeared).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigStore } from '../../src/main/brain/config';
import { defOf } from '../../src/main/brain/settings-schema';
import { tmpDir } from './brain/helpers';

const RENDERER = path.resolve(import.meta.dirname, '..', '..', 'src', 'renderer');
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));

describe('questionsModal: nobody but the user turns it off', () => {
  it('is protected: an agent gets a proposal, the switch stays on', () => {
    expect(defOf('questionsModal')!.protected).toBe(true);
    const dir = tmpDir();
    const store = new ConfigStore(dir, {});
    store.request('questionsModal', true, { by: 'user' });
    const r = store.request('questionsModal', false, { by: 'agent', chatId: 'c1' });
    expect(r).toHaveProperty('proposal');
    expect(new ConfigStore(dir, {}).get().questionsModal).toBe(true);
  });

  it('only the deliberate switches change it: Settings, the "…" menu, Ctrl+K; never the questions window', () => {
    const writers = files(RENDERER)
      .filter(f => /\btoggleQuestionsModal\b|questionsModal\s*:/.test(fs.readFileSync(f, 'utf8')))
      .map(f => path.relative(RENDERER, f).replace(/\\/g, '/'))
      .sort();
    expect(writers).toEqual(['actions.ts', 'components/CommandPalette.tsx', 'components/TopBar.tsx']);
    const win = fs.readFileSync(path.join(RENDERER, 'components', 'QuestionsWindow.tsx'), 'utf8');
    expect(win).not.toMatch(/toggleQuestionsModal|setSetting|qwin-off/);
  });
});
