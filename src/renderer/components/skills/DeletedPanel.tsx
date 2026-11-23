// «Eliminate di recente» (ADR 0340 §5): the whole skills deleted lately that can still come back, under the list of the
// Skill view. A deleted skill has no page and so no Cronologia: this is where its «Annulla» stays after the toast is gone.
// Data: SkillLibraryState.deleted (main/skills/library.ts). Used by SkillsPage.tsx; styles/skill-library.css.
import { useState } from 'react';
import type { DeletedSkill } from '@shared/skill-library';
import { t } from '../../i18n';
import { ago } from '../../lib/format';

function Line({ d, onUndo }: { d: DeletedSkill; onUndo: (name: string, changeId: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const undo = () => { setBusy(true); void onUndo(d.name, d.changeId).finally(() => setBusy(false)); };
  return <li className="sl-del-line" data-testid={`sl-del-${d.name}`}>
    <span className="sl-del-main">
      <span className="sl-del-name mono" title={d.name}>{d.name}</span>
      <span className="sl-part-desc">{ago(d.at, Date.now())} · {t('sl.facts.files', { n: d.files })}</span>
    </span>
    <button type="button" className="btn btn-ghost btn-s" onClick={undo} disabled={busy} aria-label={t('sl.del.undoLabel', { name: d.name })} data-testid="sl-del-undo">{t('sl.history.undo')}</button>
  </li>;
}

export function DeletedPanel({ items, onUndo }: { items: DeletedSkill[]; onUndo: (name: string, changeId: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return <section className="sl-del" data-testid="sl-deleted">
    <button type="button" className="sl-del-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid="sl-del-toggle">{t('sl.del.title')}<span className="sl-n">{items.length}</span></button>
    {open && <ul>{items.map(d => <Line key={d.changeId} d={d} onUndo={onUndo} />)}</ul>}
  </section>;
}
