// Main-only Battito capabilities: bounded brain inputs and user-triggered Save/Act/Approve operations.
import fs from 'node:fs';
import path from 'node:path';
import type { HeadlineState } from '../../shared/contract';
import type { Wired, Ctx } from '../wiring';
import { ideaTool, saveAiIdea } from '../brain/save-idea';
import { localDay } from '../jobs/scheduler';
import { PulseService } from './service';
import { uiLang } from '../locale';

export function createPulse(s: Wired, ctx: Ctx, legacyHeadline: () => HeadlineState): PulseService | null {
  if (!s.oneShot || !s.agentRuns) return null;
  const root = () => s.brain.info().brainRoot;
  const read = (rel: string): string => {
    const base = root(); if (!base) return '';
    try {
      const realBase = fs.realpathSync(base), file = fs.realpathSync(path.join(realBase, rel));
      const relative = path.relative(realBase, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return '';
      const stat = fs.statSync(file); if (!stat.isFile() || stat.size > 1_000_000) return '';
      return fs.readFileSync(file, 'utf8');
    } catch { return ''; }
  };
  return new PulseService({ file: path.join(ctx.userData, 'pulse.json'), once: s.oneShot, runs: s.agentRuns,
    settings: () => s.brain.settings(), visible: () => { const w = ctx.window(); return !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized(); },
    calls: !process.env.SB_TEST && !process.env.VITEST && !process.env.SB_DEMO,
    lang: uiLang, legacyHeadline,
    material: () => ({ now: read('now.md'), ideas: read('ideas.md'),
      journal: Array.from({ length: 7 }, (_, i) => read(`journal/${localDay(Date.now() - (6 - i) * 86400_000)}.md`)).join('\n'), errors: read('ai-errors.md'),
      chats: s.chats.list().map(c => ({ id: c.id, title: c.title, state: c.state })),
      agents: s.agents.list().profiles.map(a => {
        const runs = s.agentRuns!.list().filter(r => r.agentId === a.id && r.startedAt >= Date.now() - 7 * 86400_000);
        const ended = runs.filter(r => r.endedAt !== undefined), known = ended.filter(r => r.costUsd !== null);
        const success = ended.filter(r => r.outcome?.verdict === 'success').length;
        return { id: a.id, text: `${a.name}: ${runs.length} run/7d, ${success}/${ended.length} successi, $/run ${known.length ? (known.reduce((n, r) => n + r.costUsd!, 0) / known.length).toFixed(3) : 'sconosciuto'}` };
      }), files: [...new Set(s.brain.feed().filter(e => e.at >= Date.now() - 7 * 86400_000 && e.file).map(e => {
        const base = root(); return base && path.isAbsolute(e.file!) ? path.relative(base, e.file!).split(path.sep).join('/') : e.file!.split(path.sep).join('/');
      }))] }),
    emit: () => ctx.emitter.emit('pulse:changed', undefined), emitApprovals: () => ctx.emitter.emit('approvals:changed', undefined),
    emitHeadline: st => ctx.emitter.emit('headline:changed', st), canSave: () => !!ideaTool(root()),
    saveIdea: c => saveAiIdea({ root: root(), userData: ctx.userData, title: c.title, body: c.body, why: c.why, source: 'Battito' }),
    act: async c => {
      const chat = s.chats.list().find(x => x.isOrchestrator && !x.closedAt);
      if (!chat) throw Error('Apri prima l’Orchestrator');
      await s.chats.send(chat.id, `[Battito]\n${c.title}\n${c.body}\n${c.why}\nFonti: ${c.refs.map(r => r.ref).join(', ')}`);
      ctx.emitter.emit('ui:command', { action: 'focus', value: chat.id }); return chat.id;
    },
    approve: async item => {
      const agent = s.agents.list().profiles.find(p => p.id === item.agentId); if (!agent) throw Error('Agente non disponibile');
      if (item.kind === 'learned-rule') s.agents.save({ ...agent, instructions: `${agent.instructions}\n${item.text}` }, agent.id);
      else throw Error('Questa proposta richiede un’applicazione manuale.');
    },
  });
}
