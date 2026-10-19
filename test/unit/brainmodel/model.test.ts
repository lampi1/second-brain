// The Brain pages' reader (src/main/brainmodel/model.ts, ADR 0077): skills (brain first, then the user's own folders;
// who declares each one; the tools it calls), rules (always-loaded, topic, or on disk only; never me.md) and memory
// (knowledge groups by folder name, open threads, journal, errors, the shared memory and one per agent), bounded file
// reads only. Temp folders only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { firstProse, readMemory, readRules, readSkills, skillTools, touchesBrainModel } from '../../../src/main/brainmodel/model';
import type { AgentProfile } from '../../../src/shared/agents';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-model-'))); dirs.push(d); return d; };
const put = (root: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const agent = (id: string, linked: string[], status: 'active' | 'archived' = 'active') => ({ id, name: id.toUpperCase(), status, knowhow: { folder: 'x', linked, hash: 'a'.repeat(64) } }) as unknown as AgentProfile;

describe('readSkills', () => {
  it('lists brain skills before the user\'s, with who declares them and what they call', () => {
    const root = tmp(), home = tmp();
    put(root, '.claude/skills/fatture/SKILL.md', '---\nname: fatture\ndescription: Esportare le fatture\nallowed-tools: Bash, Read\n---\nUsa `node tools/export.mjs` e mcp__jira__search.\n');
    put(root, '.claude/skills/fatture/scripts/check.ps1', 'x');
    put(home, '.claude/skills/fatture/SKILL.md', '---\nname: fatture\ndescription: copia dell\'utente\n---\n');
    put(home, '.claude/skills/mia/SKILL.md', '---\nname: mia\n---\nLa mia skill personale.\n');
    put(root, '.claude/skills/Not_A_Name/SKILL.md', 'x');
    const s = readSkills([{ dir: path.join(root, '.claude/skills'), home: 'brain' }, { dir: path.join(home, '.claude/skills'), home: 'user' }], root, [agent('a', ['fatture']), agent('b', ['fatture'], 'archived')]);
    expect(s.map(x => [x.name, x.home, x.rel])).toEqual([['fatture', 'brain', '.claude/skills/fatture/SKILL.md'], ['mia', 'user', null]]);
    expect(s[0]).toMatchObject({ description: 'Esportare le fatture', usedBy: ['a'], tools: ['Bash', 'Read', 'mcp__jira__search', 'node tools/export.mjs', 'scripts/check.ps1'] });
    expect(s[1]!.description).toBe('La mia skill personale.'); // no description: its first line of prose
  });
});

describe('readRules', () => {
  it('says how each rule reaches the agents; never the profile', () => {
    const root = tmp();
    put(root, 'brain.json', JSON.stringify({ rules: { fixedFiles: ['me.md', 'AGENTS.md'], topicFiles: ['rules/stile.md'] } }));
    put(root, 'me.md', '# Io\n'); put(root, 'AGENTS.md', '# Regole del brain\nSempre in italiano.\n');
    put(root, 'rules/stile.md', '---\nwhen: {"prompt":["mail"],"tools":[],"paths":[]}\n---\n# Stile\nFrasi brevi.\n');
    put(root, 'rules/bozza.md', '# Bozza\nDa decidere.\n');
    expect(readRules(root).map(r => [r.file, r.loaded, r.title, r.summary, r.when?.prompt ?? null])).toEqual([
      ['AGENTS.md', 'always', 'Regole del brain', 'Sempre in italiano.', null],
      ['rules/stile.md', 'topic', 'Stile', 'Frasi brevi.', ['mail']],
      ['rules/bozza.md', 'none', 'Bozza', 'Da decidere.', null],
    ]);
    expect(readRules(null)).toEqual([]);
  });
});

describe('readMemory', () => {
  it('groups knowledge by folder, then what happened, the shared memory and each agent\'s', () => {
    const root = tmp();
    put(root, 'areas/clienti/rossi.md', '# Rossi\n- vuole il PDF\n- paga a 60 giorni\n');
    put(root, 'ambienti/test.md', '# Test\n- riavvio alle 6\n');
    put(root, 'persone/credentials.md', '- no');
    put(root, 'now.md', '# Fili\n- **Fatture** · in corso\n');
    put(root, 'journal/2026-10-18.md', '# 18\n'); put(root, 'journal/2026-10-19.md', '# 19\n');
    put(root, 'ai-errors.md', '# Errori\n- 2026-10-19 | a | x\n');
    put(root, 'memory/shared.md', '# Condivisa\n- uno\n');
    put(root, 'agents/a/memory.md', '# Memoria\n\n- 2026-10-19 · fatto\n');
    put(root, 'agents/a/clienti/x.md', '- not knowledge: inside agents/');
    const m = readMemory(root, [agent('a', [])]);
    expect(m.map(x => [x.kind, x.group, x.file, x.entries])).toEqual([
      ['knowledge', 'Ambienti', 'ambienti/test.md', 1],
      ['knowledge', 'Clienti', 'areas/clienti/rossi.md', 2],
      ['threads', 'Fili aperti', 'now.md', 1],
      ['journal', 'Diario', 'journal/2026-10-19.md', 2],
      ['errors', 'Errori', 'ai-errors.md', 1],
      ['shared', 'Condivisa', 'memory/shared.md', 1],
      ['agent', 'A', 'agents/a/memory.md', 1],
    ]);
    expect(m[1]!.preview).toEqual(['paga a 60 giorni', 'vuole il PDF']);
  });
});

describe('helpers', () => {
  it('touchesBrainModel, firstProse, skillTools', () => {
    expect(touchesBrainModel('rules/x.md')).toBe(true); expect(touchesBrainModel('ops/state/x.json')).toBe(false); expect(touchesBrainModel('agents')).toBe(true);
    expect(firstProse('# T\n\n```\ncode\n```\n| a |\n- **Primo** passo')).toBe('Primo passo');
    expect(skillTools('---\nname: x\nallowed-tools: [Read, "Grep"]\n---\n', null)).toEqual(['Grep', 'Read']);
  });
});
