// The brain lint's cards and what approving one does (ADR 0194, M2), and the card of a change that did not help (M4).
// Every card asks one plain question in the UI language (its title, read as the question by the deck) and its approval
// is one item delta through the change log (item-delta.ts), with «Annulla»:
//   stale-fact / changed-fact  «Il file citato non c'è più: tolgo il fatto?»   → the fact retired (memory tidy undo)
//   stale-cite                 «La skill «x» cita un file che non c'è più: tolgo la riga?» → that one line removed
//   broken-link                «Il link … non porta a niente: lo tolgo?»      → the link becomes its plain text
//   orphan                     «Nessuna nota rimanda a «x»: la aggiungo all'indice?» → one line in the hub
//   concept                    ««x» compare in N note senza una nota sua: la creo?» → a new note listing who cites it
//   revert                     «Questo cambio non ha aiutato: lo annullo?»   → the change log's rollback
// Pure but for reading the brain file a plan changes. Used by research.ts (cards) and brainmodel/service.ts (apply);
// tests: test/unit/brainmodel/lint-cards.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { Lang } from '../../shared/contract';
import type { LintFinding, ResearchProposal, ResearchRevert } from '../../shared/maintenance-research';
import { HUB } from './brain-lint';
import { itemKey, type RemovedItem } from './item-delta';
import { appendUnder } from './jobs';
import { checkWords } from './success-check';

type Card = Omit<ResearchProposal, 'id' | 'at' | 'state'>;
const clip = (s: string, n = 200): string => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const name = (file: string): string => path.basename(file).replace(/\.md$/i, '');

const IT = {
  staleFact: { title: 'Il file citato non c\'è più: tolgo il fatto', why: (p: string) => `Il fatto cita \`${p}\`, che non esiste più. Gli agenti già non lo ricevono più all'avvio; togliendolo la memoria resta pulita.`, expected: 'Un fatto in meno che porterebbe fuori strada; «Annulla» lo rimette.', risk: 'Il file è stato solo spostato e il fatto vale ancora: allora rifiuta e correggilo.' },
  changedFact: { title: 'Il file citato è cambiato: tolgo il fatto', why: (p: string) => `\`${p}\` è cambiato da quando il fatto è stato salvato: forse non vale più.`, expected: 'Nessun fatto superato dato agli agenti; «Annulla» lo rimette.', risk: 'Il cambio non tocca il fatto: allora rifiuta, non te lo richiedo per questa versione del file.' },
  staleCite: { title: (what: string) => `${what} cita un file che non c'è più: tolgo la riga`, why: (p: string) => `La riga cita \`${p}\`, che non esiste più: chi la segue cerca un file che non trova.`, expected: 'Una riga in meno che manda gli agenti a vuoto; «Annulla» la rimette.', risk: 'Il file è stato spostato: allora rifiuta e aggiorna la riga.' },
  skill: (n: string) => `La skill «${n}»`, rule: (n: string) => `La regola «${n}»`,
  broken: { title: (t: string, f: string) => `Il link a «${t}» in «${f}» non porta a niente: lo tolgo (resta il testo)`, why: (t: string) => `Nessun file del brain si chiama «${t}».`, expected: 'Un link morto in meno; il testo resta com\'è.', risk: 'La nota va solo creata o rinominata: allora rifiuta.' },
  orphan: { title: (n: string) => `Nessuna nota rimanda a «${n}»: la aggiungo all'indice`, why: 'Nessun\'altra nota del brain ha un link a questa: chi legge il brain non ci arriva.', expected: 'La nota si raggiunge dall\'indice; «Annulla» toglie la riga.', risk: 'La nota non serve più: allora rifiuta (o eliminala).' },
  concept: { title: (t: string, n: string) => `«${t}» compare in ${n} note senza una nota sua: la creo`, why: (n: string) => `Citato ${n} volte, ma il brain non spiega cos'è in un posto solo.`, expected: 'Una nota breve che dice dove se ne parla, da completare.', risk: 'È solo una parola in grassetto, non un concetto: allora rifiuta.' },
  revert: { title: (s: string) => `Questo cambio non ha aiutato: lo annullo («${s}»)`, expected: 'Il brain torna com\'era prima del cambio.', risk: 'Una settimana è poca o i lavori erano diversi: allora rifiuta e lo tengo.' },
  stub: (t: string, by: string[]) => `# ${t}\n\nCitato in: ${by.map(b => `[[${name(b)}]]`).join(', ')}.\n\nDa completare: cos'è, a cosa serve, dove se ne parla.\n`,
  hubHead: '## Note da collegare',
};
const EN: typeof IT = {
  staleFact: { title: 'The cited file is gone: remove the fact', why: (p: string) => `The fact cites \`${p}\`, which no longer exists. The agents already stop receiving it at launch; removing it keeps the memory clean.`, expected: 'One misleading fact less; «Undo» brings it back.', risk: 'The file was only moved and the fact still holds: then reject and fix it.' },
  changedFact: { title: 'The cited file changed: remove the fact', why: (p: string) => `\`${p}\` changed since the fact was saved: it may no longer hold.`, expected: 'No outdated fact given to the agents; «Undo» brings it back.', risk: 'The change does not touch the fact: then reject, I will not ask again for this version of the file.' },
  staleCite: { title: (what: string) => `${what} cites a file that is gone: remove the line`, why: (p: string) => `The line cites \`${p}\`, which no longer exists: whoever follows it looks for a file that is not there.`, expected: 'One line less sending the agents nowhere; «Undo» brings it back.', risk: 'The file was moved: then reject and update the line.' },
  skill: (n: string) => `The skill «${n}»`, rule: (n: string) => `The rule «${n}»`,
  broken: { title: (t: string, f: string) => `The link to «${t}» in «${f}» leads nowhere: remove it (the text stays)`, why: (t: string) => `No brain file is called «${t}».`, expected: 'One dead link less; the text stays as it is.', risk: 'The note only needs to be created or renamed: then reject.' },
  orphan: { title: (n: string) => `No note links to «${n}»: add it to the index`, why: 'No other brain note links to this one: whoever reads the brain never gets there.', expected: 'The note is reachable from the index; «Undo» removes the line.', risk: 'The note is no longer needed: then reject (or delete it).' },
  concept: { title: (t: string, n: string) => `«${t}» appears in ${n} notes without a note of its own: create it`, why: (n: string) => `Cited ${n} times, but the brain never explains it in one place.`, expected: 'A short note saying where it is discussed, to be completed.', risk: 'It is only a bold word, not a concept: then reject.' },
  revert: { title: (s: string) => `This change did not help: undo it («${s}»)`, expected: 'The brain goes back to how it was before the change.', risk: 'A week is short or the jobs were different: then reject and I keep it.' },
  stub: (t: string, by: string[]) => `# ${t}\n\nCited in: ${by.map(b => `[[${name(b)}]]`).join(', ')}.\n\nTo complete: what it is, what it is for, where it is discussed.\n`,
  hubHead: '## Notes to link',
};
const words = (lang: Lang): typeof IT => (lang === 'it' ? IT : EN);

/** A lint finding as a card (chatId null: the free cleanup's). */
export function lintCard(f: LintFinding, lang: Lang): Card {
  const w = words(lang), base = { chatId: null, kind: 'lint' as const, sources: [], lint: { ...f, lang: lang === 'it' ? 'it' as const : 'en' as const }, evidence: [f.key.slice(0, 300)] };
  switch (f.check) {
    case 'stale-fact': case 'changed-fact': {
      const x = f.check === 'stale-fact' ? w.staleFact : w.changedFact;
      return { ...base, title: x.title, adds: '', removes: clip(f.about ?? '', 600), why: x.why(f.target ?? ''), expected: x.expected, risk: x.risk, evidence: [`memory ${f.memoryId}`, f.target ?? ''] };
    }
    case 'stale-cite': {
      const what = f.file?.startsWith('rules/') ? w.rule(f.file) : w.skill(f.about ?? '');
      return { ...base, title: clip(w.staleCite.title(what), 120), adds: '', removes: clip(f.line ?? '', 600), why: w.staleCite.why(f.target ?? ''), expected: w.staleCite.expected, risk: w.staleCite.risk, evidence: [f.file ?? '', f.target ?? ''] };
    }
    case 'broken-link':
      return { ...base, title: clip(w.broken.title(clip(f.target ?? '', 40), name(f.file ?? '')), 120), adds: clip(plainLink(f.line ?? '', f.about ?? ''), 600), removes: clip(f.line ?? '', 600), why: w.broken.why(f.target ?? ''), expected: w.broken.expected, risk: w.broken.risk, evidence: [f.file ?? '', f.about ?? ''] };
    case 'orphan':
      return { ...base, title: clip(w.orphan.title(name(f.file ?? '')), 120), adds: `- [[${name(f.file ?? '')}]]`, removes: '', why: w.orphan.why, expected: w.orphan.expected, risk: w.orphan.risk, evidence: [f.file ?? ''] };
    case 'concept':
      return { ...base, title: clip(w.concept.title(f.target ?? '', f.about ?? ''), 120), adds: clip(w.stub(f.target ?? '', f.citedBy ?? []), 600), removes: '', why: w.concept.why(f.about ?? ''), expected: w.concept.expected, risk: w.concept.risk, evidence: (f.citedBy ?? []).slice(0, 12) };
  }
}

/** The card of a change its week-after check found worse. */
export function revertCard(r: ResearchRevert, lang: Lang): Card {
  const w = words(lang);
  return { chatId: null, kind: 'revert', title: clip(w.revert.title(clip(r.summary, 70)), 120), adds: '', removes: clip(r.summary, 600), why: checkWords(r.criterion, r.check, lang),
    evidence: [`change ${r.changeId}`, `${r.criterion.metric}: ${r.check.before ?? '—'} → ${r.check.after ?? '—'}`], sources: [], expected: w.revert.expected, risk: w.revert.risk, revert: r };
}

/** The line with the link turned into its plain text: a [[wiki|alias]] its alias or target, a [text](x) its text. */
export function plainLink(line: string, raw: string): string {
  const wiki = /^!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/.exec(raw);
  const md = /^!?\[([^\]]*)\]\(/.exec(raw);
  const text = wiki ? (wiki[2]?.trim() || wiki[1]!.trim()) : md ? md[1]! : raw;
  return line.split(raw).join(text);
}

/** What approving a lint card writes: one file, the items it removes with why, and the change's words. */
export interface LintPlan { kind: 'skill' | 'rule' | 'memory'; action: 'create' | 'update' | 'remove'; target: string; file?: string; text?: string; removed?: RemovedItem[]; memoryId?: string; summary: string }

const readText = (file: string): string | null => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
/** The one line of `text` equal to `line` (as an item) removed, or replaced by `next`; null when it is not there (once). */
function replaceLine(text: string, line: string, next: string | null): string | null {
  const lines = text.split('\n'), k = itemKey(line);
  const at = lines.findIndex(l => itemKey(l) === k);
  if (at < 0) return null;
  if (next === null) lines.splice(at, 1); else lines[at] = lines[at]!.replace(/\r$/, '') === lines[at] ? next : `${next}\r`;
  return lines.join('\n');
}
const gone = (): Error => new Error('Il problema non c\'è più: la nota è già cambiata. Rifiuta la proposta.');

/** The plan for a lint card at approval time: the finding is checked again on the brain as it is now. */
export function lintPlan(root: string, f: LintFinding, lang: Lang, reason: string): LintPlan {
  const inside = (r: string): string => { const p = path.resolve(root, r); if (!p.startsWith(path.resolve(root) + path.sep)) throw new Error('File fuori dal brain.'); return p; };
  switch (f.check) {
    case 'stale-fact': case 'changed-fact':
      if (!f.memoryId) throw gone();
      return { kind: 'memory', action: 'remove', target: f.memoryId, memoryId: f.memoryId, summary: `${lang === 'it' ? 'Fatto tolto' : 'Fact removed'}: ${clip(f.about ?? '', 120)}` };
    case 'stale-cite': case 'broken-link': {
      if (!f.file || !f.line) throw gone();
      const file = inside(f.file), before = readText(file);
      if (before === null) throw gone();
      const next = f.check === 'stale-cite' ? null : plainLink(f.line.replace(/\r$/, ''), f.about ?? '');
      const text = replaceLine(before, f.line, next);
      if (text === null) throw gone();
      const kind = /(?:^|\/)SKILL\.md$/i.test(f.file) ? 'skill' : 'rule';
      return { kind, action: 'update', target: kind === 'skill' ? path.basename(path.dirname(f.file)) : f.file, file, text, removed: [{ item: f.line, reason }], summary: clip(f.check === 'stale-cite' ? `${f.file}: ${lang === 'it' ? 'tolta la riga che cita' : 'removed the line citing'} ${f.target}` : `${f.file}: ${lang === 'it' ? 'link morto tolto' : 'dead link removed'} (${f.target})`, 200) };
    }
    case 'orphan': {
      if (!f.file || !fs.existsSync(inside(f.file))) throw gone();
      // the brain's hub at its top: hub.md, index.md, README.md, START-HERE.md; else a new hub.md
      let hub: string | undefined;
      try { hub = fs.readdirSync(root).filter(n => HUB.test(n) && !/^(?:agents|claude|changelog|license|contributing)\.md$/i.test(n)).sort((a, b) => rank(a) - rank(b))[0]; } catch { /* none */ }
      const file = path.join(root, hub ?? 'hub.md'), before = readText(file) ?? '', w = words(lang);
      const line = `- [[${name(f.file)}]]`;
      if (before.split('\n').some(l => itemKey(l) === line)) throw gone();
      const head = w.hubHead.replace(/^##\s+/, '');
      const text = before.trim() ? appendUnder(before, head, line) : `${w.hubHead}\n\n${line}\n`;
      return { kind: 'rule', action: hub ? 'update' : 'create', target: rel(root, file), file, text, summary: `${rel(root, file)}: ${lang === 'it' ? 'collegata' : 'linked'} «${name(f.file)}»` };
    }
    case 'concept': {
      const t = (f.target ?? '').trim();
      if (!t) throw gone();
      const safe = t.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!safe) throw gone();
      const file = path.join(root, `${safe}.md`);
      if (fs.existsSync(file)) throw gone();
      return { kind: 'rule', action: 'create', target: `${safe}.md`, file, text: words(lang).stub(t, f.citedBy ?? []), summary: `${lang === 'it' ? 'Nuova nota' : 'New note'} «${safe}»` };
    }
  }
}
const rank = (n: string): number => ['hub.md', 'index.md', 'readme.md', 'start-here.md', 'home.md', 'moc.md', '_index.md'].indexOf(n.toLowerCase()) + 1 || 99;
const rel = (root: string, file: string): string => path.relative(root, file).split(path.sep).join('/');
