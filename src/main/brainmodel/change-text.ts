// The one-line summary of a maintenance change (jobs.ts) in the UI language (locale.ts uiLang: the setting, else
// Windows' language; Italian before the settings are read and in unit tests), as the Memoria head, Apprendimento and
// the Proposals deck show it. Written once into the change log, so a change keeps the language it was made in. The
// reasons stay in Italian (the brain's own language). Pure apart from uiLang. Used by jobs.ts.
import type { Lang } from '../../shared/contract';
import { uiLang } from '../locale';

interface ChangeText {
  newSkill(p: { name: string; file: string; title: string }): string;
  lesson(p: { skill: string; rule: string }): string;
  newRule(p: { rule: string }): string;
  candidate(p: { name: string; n: number }): string;
  link(p: { agent: string; name: string; drop?: string }): string;
  merge(p: { drop: string; keep: string }): string;
  memoryTidy(p: { agent: string; generalized: number; merged: number; dropped: number }): string;
}

const TEXT: Readonly<Record<Lang, ChangeText>> = {
  it: {
    newSkill: p => `Nuova skill «${p.name}» da ${p.file} (${p.title})`,
    lesson: p => `Lezione aggiunta alla skill «${p.skill}»: ${p.rule}`,
    newRule: p => `Nuova regola: ${p.rule}`,
    candidate: p => `Skill candidata «${p.name}» da ${p.n} richieste`,
    link: p => `${p.agent} usa «${p.name}»${p.drop ? ` al posto di «${p.drop}»` : ''}`,
    merge: p => `«${p.drop}» unita in «${p.keep}»`,
    memoryTidy: p => `Memoria di ${p.agent}: ${[p.generalized ? `${p.generalized} ${p.generalized === 1 ? 'fatto reso generale' : 'fatti resi generali'}` : '', p.merged ? `${p.merged} ${p.merged === 1 ? 'doppione unito' : 'doppioni uniti'}` : '', p.dropped ? `${p.dropped} ${p.dropped === 1 ? 'fatto legato a un caso tolto' : 'fatti legati a un caso tolti'}` : ''].filter(Boolean).join(', ')}`,
  },
  en: {
    newSkill: p => `New skill «${p.name}» from ${p.file} (${p.title})`,
    lesson: p => `Lesson added to the skill «${p.skill}»: ${p.rule}`,
    newRule: p => `New rule: ${p.rule}`,
    candidate: p => `Candidate skill «${p.name}» from ${p.n} requests`,
    link: p => `${p.agent} uses «${p.name}»${p.drop ? ` instead of «${p.drop}»` : ''}`,
    merge: p => `«${p.drop}» merged into «${p.keep}»`,
    memoryTidy: p => `${p.agent}'s memory: ${[p.generalized ? `${p.generalized} ${p.generalized === 1 ? 'fact made general' : 'facts made general'}` : '', p.merged ? `${p.merged} ${p.merged === 1 ? 'duplicate merged' : 'duplicates merged'}` : '', p.dropped ? `${p.dropped} case-specific ${p.dropped === 1 ? 'fact' : 'facts'} dropped` : ''].filter(Boolean).join(', ')}`,
  },
  de: {
    newSkill: p => `Neuer Skill «${p.name}» aus ${p.file} (${p.title})`,
    lesson: p => `Lektion zum Skill «${p.skill}» hinzugefügt: ${p.rule}`,
    newRule: p => `Neue Regel: ${p.rule}`,
    candidate: p => `Skill-Kandidat «${p.name}» aus ${p.n} Anfragen`,
    link: p => `${p.agent} nutzt «${p.name}»${p.drop ? ` statt «${p.drop}»` : ''}`,
    merge: p => `«${p.drop}» in «${p.keep}» zusammengeführt`,
    memoryTidy: p => `Gedächtnis von ${p.agent}: ${[p.generalized ? `${p.generalized} ${p.generalized === 1 ? 'Fakt verallgemeinert' : 'Fakten verallgemeinert'}` : '', p.merged ? `${p.merged} ${p.merged === 1 ? 'Duplikat zusammengeführt' : 'Duplikate zusammengeführt'}` : '', p.dropped ? `${p.dropped} ${p.dropped === 1 ? 'fallbezogener Fakt' : 'fallbezogene Fakten'} entfernt` : ''].filter(Boolean).join(', ')}`,
  },
};

/** The summaries in the UI language now. */
export const changeText = (): ChangeText => TEXT[uiLang()];
