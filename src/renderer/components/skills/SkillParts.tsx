// What a skill's package holds, by the Agent Skills folders (ADR 0263; the owner, 2026-11-10: «la visualizzazione delle
// skill dell'app con una UI che mostrasse script e query legati alle skill, come da documentazione delle skill»): Script
// (scripts/, with the title, what it does, the language and its last test from the header), Query (assets/queries/, with
// the language), Riferimenti (references/) and Asset (the rest of assets/). A row opens the file in the File tab. Read
// only: LibSkill.parts from main (skills/assets.ts skillParts). Used by SkillDetail.tsx (Leggi); styles/skill-library.css.
import type { ReactNode } from 'react';
import type { LibSkill, SkillPart, SkillParts as Parts } from '@shared/skill-library';
import { t } from '../../i18n';
import { IconBook, IconFile, IconLayers, IconTerminal } from '../Icons';

const GROUPS: { key: keyof Parts; icon: ReactNode; folder: string }[] = [
  { key: 'scripts', icon: <IconTerminal size={14} />, folder: 'scripts/' },
  { key: 'queries', icon: <IconLayers size={14} />, folder: 'assets/queries/' },
  { key: 'references', icon: <IconBook size={14} />, folder: 'references/' },
  { key: 'assets', icon: <IconFile size={14} />, folder: 'assets/' },
];

function Row({ part, onOpen }: { part: SkillPart; onOpen: (path: string) => void }) {
  return <li>
    <button type="button" className="sl-part" onClick={() => onOpen(part.path)} title={t('sl.parts.open', { path: part.path })} data-testid={`sl-part-${part.path}`}>
      <span className="sl-part-main">
        <span className="sl-part-title">{part.title}</span>
        {part.description && <span className="sl-part-desc">{part.description}</span>}
      </span>
      <span className="sl-part-meta">
        {part.language && <span className="sl-chip">{part.language}</span>}
        {part.tested && <span className="sl-part-tested" data-state={part.tested}>{t(`sl.parts.tested.${part.tested}`)}</span>}
        <span className="mono sl-part-path">{part.path}</span>
      </span>
    </button>
  </li>;
}

export function SkillParts({ skill, onOpen }: { skill: LibSkill; onOpen: (path: string) => void }) {
  const groups = GROUPS.filter(g => skill.parts[g.key].length);
  return <section className="sl-parts" aria-label={t('sl.parts.title')} data-testid="sl-parts">
    {!groups.length ? <p className="sl-muted small" data-testid="sl-parts-none">{t('sl.parts.none')}</p>
      : groups.map(g => <div key={g.key} className="sl-part-group" data-group={g.key} data-testid={`sl-parts-${g.key}`}>
        <h3>{g.icon}<span>{t(`sl.parts.${g.key}`)}</span><span className="sl-n">{skill.parts[g.key].length}</span><span className="mono sl-part-folder">{g.folder}</span></h3>
        <ul>{skill.parts[g.key].map(p => <Row key={p.path} part={p} onOpen={onOpen} />)}</ul>
      </div>)}
  </section>;
}
