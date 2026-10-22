// The questions window is always on (the owner, 2026-10-22: "voglio sempre i popup attivi di default senza possibilità
// di disabilitarli"): there is no setting to turn it off and no switch anywhere (Settings, top bar, Ctrl+K, the window).
// Before, a "Domande in finestra" switch existed and requests could also be answered in the chats' tiles.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { defOf } from '../../src/main/brain/settings-schema';

const RENDERER = path.resolve(import.meta.dirname, '..', '..', 'src', 'renderer');
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));

describe('questions window: always on', () => {
  it('has no setting', () => {
    expect(defOf('questionsModal')).toBeNull();
  });

  it('has no switch in the renderer', () => {
    const switches = files(RENDERER).filter(f => /\btoggleQuestionsModal\b|questionsModal|topbar-qwin/.test(fs.readFileSync(f, 'utf8')));
    expect(switches).toEqual([]);
  });
});
