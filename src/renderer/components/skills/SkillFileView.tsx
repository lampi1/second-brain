// One file of a skill, read only (owner 2026-11-23: every file «si devono poter aprire tutti e vederne il contenuto»):
// Markdown rendered (with a switch to its source), code and text highlighted with line numbers (brain CodeBlock, the
// viewer's own highlighter), images shown, and for any other binary (PDF, Office) a button that opens it in the file
// viewer. Editing is SkillDetail's. Used by skills/SkillDetail.tsx; styles/skill-library.css.
import { useEffect, useMemo, useState } from 'react';
import type { SkillFileText } from '@shared/skill-library';
import { parseMd } from '@shared/skillmd';
import { t } from '../../i18n';
import { openFileViewer } from '../../actions';
import { Code } from '../../brain/components/CodeBlock';
import { Markdown } from '../../brain/components/Markdown';
import { isImagePath, isMarkdownPath } from '../../lib/skill-files';
import '../../brain/brain.css';
import '../../styles/viewer.css';

/** An image of the package, read by main like the viewer reads it; null = not an image main can show. */
function useImage(abs: string | null): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    if (abs) void window.sb.invoke('app:readFile', { path: abs }).then(r => { if (live && r.kind === 'image') setSrc(r.dataUrl); }, () => {});
    return () => { live = false; };
  }, [abs]);
  return src;
}

export function SkillFileView({ doc, folder, source }: { doc: SkillFileText; folder: string; /** show Markdown as its source */ source: boolean }) {
  const abs = `${folder.replaceAll('\\', '/')}/${doc.path}`;
  const image = useImage(doc.text === null && isImagePath(doc.path) ? abs : null);
  const body = useMemo(() => (doc.text !== null && isMarkdownPath(doc.path) ? (doc.path === 'SKILL.md' ? parseMd(doc.text).body.replace(/^\s+/, '') : doc.text) : ''), [doc]);
  if (doc.text === null) {
    return <div className="sl-view sl-view-binary" data-testid="sl-view" data-kind={image ? 'image' : 'binary'}>
      {image ? <img src={image} alt={doc.path} /> : <p className="sl-note">{t('sl.files.binary')}</p>}
      <button type="button" className="btn btn-ghost btn-s" onClick={() => openFileViewer(abs)} data-testid="sl-open-viewer">{t('sl.files.openViewer')}</button>
    </div>;
  }
  if (isMarkdownPath(doc.path) && !source) return <div className="sl-view sl-prose" data-testid="sl-view" data-kind="markdown"><Markdown text={body || '—'} copyBlocks testId="sl-md" /></div>;
  return <div className="sl-view bx" data-testid="sl-view" data-kind="code"><div className="vw-main sl-view-code"><Code text={doc.text} path={doc.path} wrap /></div></div>;
}
