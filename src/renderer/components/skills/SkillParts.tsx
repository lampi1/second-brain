// What a skill's package holds (ADR 0263; owner 2026-11-23: «gli asset devono essere visibili e capire subito se sono
// script o query riferimenti e si devono poter aprire tutti»): the files by kind (lib/skill-files.ts), each kind with its
// own icon, word and hue. KindBadge and KIND_ICON are shared with the list's rows and the File tab; SkillParts is the
// overview under Leggi (a card per kind, every row opens its file), AssetNav the File tab's left column. Read only.
// Used by SkillsPage.tsx and SkillDetail.tsx; styles/skill-library.css.
import { useMemo, type ReactNode } from 'react';
import type { LibSkill } from '@shared/skill-library';
import { t } from '../../i18n';
import { fileName, groupFiles, type SkillFileItem, type SkillFileKind } from '../../lib/skill-files';
import { IconBook, IconEdit, IconFile, IconFolder, IconLayers, IconPlus, IconTerminal } from '../Icons';

export const KIND_ICON: Record<SkillFileKind, (size: number) => ReactNode> = {
  instructions: n => <IconEdit size={n} />,
  script: n => <IconTerminal size={n} />,
  query: n => <IconLayers size={n} />,
  reference: n => <IconBook size={n} />,
  asset: n => <IconFile size={n} />,
  other: n => <IconFolder size={n} />,
};

export const fileSize = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${Math.round(n / 102.4) / 10} KB` : `${Math.round(n / 1024 / 102.4) / 10} MB`);

export function KindBadge({ kind }: { kind: SkillFileKind }) {
  return <span className="sl-kind" data-kind={kind}>{KIND_ICON[kind](12)}{t(`sl.kind.${kind}`)}</span>;
}

function Tested({ f }: { f: SkillFileItem }) {
  return f.tested && f.kind === 'script' ? <span className="sl-part-tested" data-state={f.tested}>{t(`sl.parts.tested.${f.tested}`)}</span> : null;
}

function Row({ f, onOpen }: { f: SkillFileItem; onOpen: (path: string) => void }) {
  return <li>
    <button type="button" className="sl-part" data-kind={f.kind} onClick={() => onOpen(f.path)} title={t('sl.parts.open', { path: f.path })} data-testid={`sl-part-${f.path}`}>
      <span className="sl-part-icon" aria-hidden>{KIND_ICON[f.kind](15)}</span>
      <span className="sl-part-main">
        <span className="sl-part-title">{f.title}</span>
        {f.description && <span className="sl-part-desc">{f.description}</span>}
        <span className="sl-part-meta">
          {f.language && <span className="sl-chip">{f.language}</span>}
          <Tested f={f} />
          <span className="mono sl-part-path">{f.path}</span>
        </span>
      </span>
      <span className="sl-part-size">{fileSize(f.size)}</span>
    </button>
  </li>;
}

/** Leggi: the package at a glance, a card per kind. */
export function SkillParts({ skill, onOpen }: { skill: LibSkill; onOpen: (path: string) => void }) {
  const groups = useMemo(() => groupFiles(skill).filter(g => g.kind !== 'instructions'), [skill]);
  return <section className="sl-parts" aria-label={t('sl.parts.title')} data-testid="sl-parts">
    {!groups.length ? <p className="sl-muted small" data-testid="sl-parts-none">{t('sl.parts.none')}</p>
      : groups.map(g => <div key={g.kind} className="sl-part-group" data-kind={g.kind} data-testid={`sl-parts-${g.kind}`}>
        <h3><KindBadge kind={g.kind} /><span className="sl-n">{g.items.length}</span></h3>
        <ul>{g.items.map(f => <Row key={f.path} f={f} onOpen={onOpen} />)}</ul>
      </div>)}
  </section>;
}

/** The File tab's left column: every file of the package, by kind. */
export function AssetNav({ skill, path, onPick, adding, onAdd }: { skill: LibSkill; path: string; onPick: (p: string) => void; adding: boolean; onAdd: () => void }) {
  const groups = useMemo(() => groupFiles(skill), [skill]);
  return <nav className="sl-tree" aria-label={t('sl.files.tree')} data-testid="sl-tree">
    {groups.map(g => <div key={g.kind} className="sl-tree-group" data-kind={g.kind} data-testid={`sl-group-${g.kind}`}>
      <div className="sl-tree-head"><KindBadge kind={g.kind} /><span className="sl-n">{g.items.length}</span></div>
      {g.items.map(f => <button key={f.path} type="button" className="sl-tree-file" data-kind={g.kind} aria-current={f.path === path ? 'true' : undefined} title={f.path}
        onClick={() => onPick(f.path)} data-testid={`sl-file-${f.path}`} data-binary={!f.text}>
        <span className="sl-tree-icon" aria-hidden>{KIND_ICON[g.kind](13)}</span>
        <span className="sl-tree-name">{fileName(f.path)}</span>
        {f.language && <span className="sl-tree-lang">{f.language}</span>}
        <span className="sl-tree-size">{fileSize(f.size)}</span></button>)}
    </div>)}
    <button type="button" className="sl-tree-add" onClick={onAdd} aria-expanded={adding} data-testid="sl-file-new"><IconPlus size={13} />{t('sl.files.new')}</button>
  </nav>;
}
