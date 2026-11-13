// «Da assegnare» (ADR 0263): the scripts and queries still in the brain's old scripts/ and queries/ that the automatic
// move could not place (no skill names them, several do, the skill has another file of that name, too big). One line
// each, with why; the user picks the brain skill and «Sposta» moves it there (skills:assign, one change with Annulla in
// the skill's history). The skills that name a file come first in the list. Used by SkillsPage.tsx; styles/skill-library.css.
import { useState } from 'react';
import type { LibSkill, UnassignedAsset } from '@shared/skill-library';
import { Select } from '../Select';
import { t } from '../../i18n';
import { toast } from '../../store/ui';
import { errText } from '../../lib/ipc-error';
import { IconLayers, IconTerminal } from '../Icons';

function Line({ a, skills, onMoved }: { a: UnassignedAsset; skills: LibSkill[]; onMoved: (skill: string) => void }) {
  const brain = skills.filter(s => s.origin === 'brain');
  const first = brain.filter(s => a.candidates.includes(s.name)), rest = brain.filter(s => !a.candidates.includes(s.name));
  const [to, setTo] = useState(first.length === 1 ? first[0]!.name : '');
  const [busy, setBusy] = useState(false);
  const move = async () => {
    if (!to) return;
    setBusy(true);
    try {
      const r = await window.sb.invoke('skills:assign', { kind: a.kind, name: a.name, skill: to });
      if (!r.ok) { toast(r.error, 'err'); return; }
      toast(t('sl.un.moved', { file: r.file }), 'ok');
      onMoved(to);
    } catch (e) { toast(errText(e), 'err'); } finally { setBusy(false); }
  };
  const why = a.reason === 'many' ? t('sl.un.reason.many', { list: a.candidates.join(', ') }) : t(`sl.un.reason.${a.reason}`);
  return <li className="sl-un-line" data-testid={`sl-un-${a.kind}-${a.name}`}>
    <span className="sl-un-icon" aria-hidden>{a.kind === 'script' ? <IconTerminal size={14} /> : <IconLayers size={14} />}</span>
    <span className="sl-un-main">
      <span className="sl-part-title">{a.title}</span>
      <span className="sl-part-desc"><span className="mono">{a.kind === 'script' ? 'scripts/' : 'queries/'}{a.name}</span> · {t(`sl.un.kind.${a.kind}`)} · {why}</span>
    </span>
    <Select className="st-select" value={to} onChange={e => setTo(e.target.value)} aria-label={t('sl.un.pick')} data-testid="sl-un-skill">
      <option value="">{t('sl.un.pick')}</option>
      {[...first, ...rest].map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
    </Select>
    <button type="button" className="btn btn-primary btn-s" onClick={() => void move()} disabled={!to || busy} data-testid="sl-un-move">{t('sl.un.move')}</button>
  </li>;
}

export function UnassignedPanel({ items, skills, onMoved }: { items: UnassignedAsset[]; skills: LibSkill[]; onMoved: (skill: string) => void }) {
  const [open, setOpen] = useState(false);
  return <section className="sl-un" data-open={open} data-testid="sl-unassigned">
    <div className="sl-un-head">
      <span className="sl-un-title">{t('sl.un.title', { n: items.length })}</span>
      <button type="button" className="btn btn-ghost btn-s" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid="sl-un-toggle">{open ? t('sl.un.hide') : t('sl.un.show')}</button>
    </div>
    {open && <>
      <p className="sl-un-lead small">{t('sl.un.lead')}</p>
      <ul>{items.map(a => <Line key={`${a.kind}:${a.name}`} a={a} skills={skills} onMoved={onMoved} />)}</ul>
    </>}
  </section>;
}
