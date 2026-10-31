// Impara's teachers after the real run of 2026-10-31 (evidence/real-engines/report.md, items 3 and 4): every model an
// engine lists is offered (no cut at 20, so OpenCode's free ones, last in its list, can be picked; the form searches
// them), Cursor offers only what `agent --model` takes (`auto`, then the list its refusal gave), the refusal is read
// and kept (learn/accepted-models.ts), and a lesson whose research failed says why (shared/lesson.ts degradedCause).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { teacherOption } from '../../src/main/learn/sources';
import { AcceptedModels, PROBE_MODEL, parseModelRefusal, probeAccepted } from '../../src/main/learn/accepted-models';
import { degradedCause, MODEL_REFUSED, refusedModel, TOOLS_REFUSED } from '../../src/shared/lesson';
import { teacherModels } from '../../src/renderer/components/impara/ImparaOptions';

const opencode = { id: 'opencode', label: 'OpenCode', kind: 'acp', caps: { effort: false } };
const cursor = { id: 'cursor', label: 'Cursor', kind: 'acp', caps: { effort: true } };
const claude = { id: 'claude', label: 'Claude', kind: 'claude', caps: { effort: true } };
/** OpenCode's list as it came: 30 paid models first, the free ones last */
const OPENCODE_SEEN = [...Array.from({ length: 30 }, (_, i) => ({ id: `openai/gpt-${i}`, name: `openai/gpt-${i}` })),
  { id: 'opencode/deepseek-v4.1-flash-free', name: 'opencode/deepseek-v4.1-flash-free' }];
/** Cursor's ACP list (what its chats show) */
const CURSOR_SEEN = [{ id: 'auto-smart', name: 'Auto' }, { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }, { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }];
/** The CLI's refusal of 2026-10-31, shortened */
const REFUSAL = 'Cannot use this model: auto-smart. Available models: auto, gpt-5.3-codex, gpt-5.2, composer-2.5, claude-opus-5-5-high, gpt-5.6-sol-high, gemini-3.1-pro';

describe('teacherOption', () => {
  it('offers every model an engine lists, the free ones after the first 20 too', () => {
    const o = teacherOption(opencode, OPENCODE_SEEN);
    expect(o.models).toHaveLength(31);
    expect(o.models.map(m => m.id)).toContain('opencode/deepseek-v4.1-flash-free');
  });

  it('Cursor: only `auto` until its command line listed what it takes, never an id it refuses', () => {
    const o = teacherOption(cursor, CURSOR_SEEN);
    expect(o.models).toEqual([{ id: 'auto', name: 'Auto' }]);
    expect(o.models.map(m => m.id)).not.toContain('auto-smart');
  });

  it('once the engine listed the ids it takes, offers exactly those (Fable never), named as its chats name them', () => {
    const o = teacherOption(cursor, CURSOR_SEEN, ['auto', 'claude-opus-5-5-high', 'gpt-5.2', 'claude-fable-5-1']);
    expect(o.models.map(m => m.id)).toEqual(['auto', 'claude-opus-5-5-high', 'gpt-5.2']);
    expect(o.models[0]!.name).toBe('Auto');
  });

  it('Claude keeps its aliases first', () => {
    const o = teacherOption(claude, [{ id: 'claude-opus-5-5', name: 'Opus 5.5' }]);
    expect(o.models.map(m => m.id)).toEqual(['opus', 'sonnet', 'haiku', 'claude-opus-5-5']);
  });
});

describe('parseModelRefusal', () => {
  it('reads the refused model and the accepted ones (ids with dots), and nothing else', () => {
    expect(parseModelRefusal(`Error: ${REFUSAL}`)).toEqual({ model: 'auto-smart', accepted: ['auto', 'gpt-5.3-codex', 'gpt-5.2', 'composer-2.5', 'claude-opus-5-5-high', 'gpt-5.6-sol-high', 'gemini-3.1-pro'], partial: false });
    expect(parseModelRefusal('Cannot use this model: gpt-5.6-sol. Available models: auto, rm -rf /, $(x)')?.accepted).toEqual(['auto']);
    expect(parseModelRefusal('il motore si è chiuso prima di finire')).toBeNull();
  });

  it('a chat exit error cut at 600 characters (acp.ts onClose) gives a partial list, stopped at the next stderr line', () => {
    expect(parseModelRefusal('Cannot use this model: x. Available models: auto, gpt-5.2, composer-2…')).toEqual({ model: 'x', accepted: ['auto', 'gpt-5.2'], partial: true });
    expect(parseModelRefusal('Cannot use this model: x. Available models: auto, gpt-5.2 · exit 1')).toEqual({ model: 'x', accepted: ['auto', 'gpt-5.2'], partial: false });
  });
});

describe('AcceptedModels', () => {
  const store = () => new AcceptedModels(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-acc-')), 'learn', 'accepted-models.json'));

  it('keeps the list per engine on disk; a model the CLI dropped leaves it with the next refusal', () => {
    const s = store();
    expect(s.get('cursor')).toBeNull();
    s.learn('cursor', ['auto', 'gpt-5.2', 'composer-2.5']);
    expect(s.get('cursor')).toEqual(['auto', 'gpt-5.2', 'composer-2.5']);
    // a cut list (partial) never shrinks it, only adds
    s.learn('cursor', ['auto'], true);
    expect(s.get('cursor')).toEqual(['auto', 'gpt-5.2', 'composer-2.5']);
    s.learn('cursor', ['auto', 'gpt-6'], true);
    expect(s.get('cursor')).toEqual(['auto', 'gpt-5.2', 'composer-2.5', 'gpt-6']);
    s.learn('cursor', ['auto', 'gpt-5.2']);
    expect(s.get('cursor')).toEqual(['auto', 'gpt-5.2']);
    s.learn('cursor', ['auto', 'kimi-k3-low']);
    expect(s.get('cursor')).toEqual(['auto', 'kimi-k3-low']);
    s.learn('../x', ['auto']);
    expect(s.get('../x')).toBeNull();
  });

  it('asks the engine once with a model no CLI has, and learns the list its refusal gives', async () => {
    const s = store();
    const asked: string[] = [];
    const ok = await probeAccepted('cursor', s, async model => { asked.push(model); return { ok: false, acceptedModels: parseModelRefusal(REFUSAL.replace('auto-smart', model))!.accepted }; });
    expect(ok).toBe(true);
    expect(asked).toEqual([PROBE_MODEL]);
    expect(teacherOption(cursor, CURSOR_SEEN, s.get('cursor')).models.map(m => m.id)).toContain('claude-opus-5-5-high');
    expect(await probeAccepted('opencode', s, async () => ({ ok: true }))).toBe(false);
    expect(s.get('opencode')).toBeNull();
  });
});

describe('degradedCause', () => {
  it('says the refused model, the refused tools or the engine’s words', () => {
    expect(degradedCause(`failed: ${MODEL_REFUSED}auto-smart`)).toEqual({ kind: 'model', model: 'auto-smart' });
    expect(degradedCause(`failed: ${REFUSAL}`)).toEqual({ kind: 'model', model: 'auto-smart' });
    expect(degradedCause(`failed: ${TOOLS_REFUSED}Read, Grep`)).toEqual({ kind: 'tools', tools: 'Read, Grep' });
    expect(degradedCause('failed: tempo scaduto (45 min): fermato')).toEqual({ kind: 'other', text: 'tempo scaduto (45 min): fermato' });
  });

  it('finds the refused model inside a failed lesson’s error too, so it is said in the user’s language', () => {
    expect(refusedModel(`Il modello non ha preparato la lezione: ${MODEL_REFUSED}auto-smart`)).toBe('auto-smart');
    expect(refusedModel(`Il modello non ha preparato la lezione: ${REFUSAL}`)).toBe('auto-smart');
    expect(refusedModel('Il modello non ha preparato la lezione: tempo scaduto')).toBeNull();
    expect(refusedModel(undefined)).toBeNull();
  });
});

describe('teacherModels (the form’s search)', () => {
  const models = teacherOption(opencode, OPENCODE_SEEN).models;
  it('finds the free models by any part of the id, any case, and keeps the chosen one', () => {
    expect(teacherModels(models, 'FREE', null).map(m => m.id)).toEqual(['opencode/deepseek-v4.1-flash-free']);
    expect(teacherModels(models, 'free', 'openai/gpt-3').map(m => m.id)).toEqual(['openai/gpt-3', 'opencode/deepseek-v4.1-flash-free']);
    expect(teacherModels(models, '  ', null)).toHaveLength(31);
  });
});
