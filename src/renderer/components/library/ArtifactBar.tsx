// The viewer's artifact bar (ADR 0319): above a file that is one of Memoria's artifacts, the chat that produced it (a
// click opens it, a closed one comes back on the grid), its versions (another version opens in the viewer: the file, or
// the copy the app kept when it changed or went), the related artifacts (same chat, same folder, same area those days:
// shared/library.ts relatedArtifacts), «Apri con l'app» (the system's program: the first button for a file the viewer
// does not render, Word, Excel, a video) and a way to the gallery. Nothing when the file is not an artifact. Used by
// brain/pages/FileViewer.tsx (CitedFile). Styles: styles/library.css (lib-vbar).
import { useMemo, useState } from 'react';
import { artifactOfPath, opensInViewer, relatedArtifacts } from '@shared/library';
import { locale, t } from '../../i18n';
import { badgeOf, openWithApp, pagePlatform, useLibrary } from '../../lib/library';
import { hubArg } from '../../lib/memory-hub';
import { IconChat, IconExternal, IconLayers } from '../Icons';
import { openArtifact, openArtifactChat, openGallery } from './open';
import '../../styles/library.css';

const stamp = (ms: number) => new Date(ms).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function ArtifactBar({ path }: { path: string }) {
  const { list } = useLibrary();
  const hit = useMemo(() => artifactOfPath(list.artifacts, path, pagePlatform()), [list.artifacts, path]);
  const related = useMemo(() => (hit ? relatedArtifacts(hit.artifact, list.artifacts) : []), [hit, list.artifacts]);
  const [failed, setFailed] = useState<{ path: string; error: string } | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  if (!hit) return null;
  const outside = !opensInViewer(path);
  const openApp = <button type="button" className={outside ? 'lib-vbar-app primary' : 'lib-vbar-app'} title={t('lib.bar.openAppTip')} data-testid="lib-vbar-app" data-opened={opened === path || undefined}
    onClick={() => { setFailed(null); setOpened(null); void openWithApp(path).then(error => { if (error) setFailed({ path, error }); else setOpened(path); }); }}><IconExternal size={13} /><span>{t('lib.bar.openApp')}</span></button>;
  const { artifact: a, version } = hit;
  const n = a.versions.length;
  return <nav className="lib-vbar" aria-label={t('lib.bar.label')} data-testid="lib-vbar">
    <span className="lib-vbar-label"><IconLayers size={14} />{t('lib.bar.label')}</span>
    {outside && openApp}
    {a.chatId ? <button type="button" onClick={() => openArtifactChat(a.chatId!)} title={t('lib.openChat')} data-testid="lib-vbar-chat">
      <IconChat size={13} /><span>{a.chatTitle ?? t('lib.fromChatGone')}</span></button>
      : <span className="lib-vbar-none">{t('lib.bar.noChat')}</span>}
    {n > 1 && <select aria-label={t('lib.bar.versionsLabel')} value={version} onChange={e => openArtifact(a, Number(e.target.value))} data-testid="lib-vbar-versions">
      {a.versions.map((v, i) => <option key={`${v.path}@${v.at}`} value={i} disabled={!!v.missing && !v.copy}>
        {`${t('lib.bar.version', { i: n - i, n })} · ${stamp(v.at)}${i === 0 && !v.missing ? ` · ${t('lib.bar.current')}` : v.missing ? ` · ${v.copy ? t('lib.bar.copy') : t('lib.bar.gone')}` : ''}`}
      </option>)}
    </select>}
    <span className="sp" />
    {!outside && openApp}
    <button type="button" onClick={() => openGallery(hubArg('artifact'))} data-testid="lib-vbar-gallery"><span>{t('lib.bar.inMemory')}</span></button>
    {failed?.path === path && <p className="lib-vbar-err" role="alert">{t('lib.bar.openFailed')} {failed.error}</p>}
    {related.length > 0 && <div className="lib-vbar-rel" role="group" aria-label={t('lib.bar.relatedLabel')}>
      <span>{t('lib.bar.related')}</span>
      {related.map(b => <button key={b.id} type="button" onClick={() => openArtifact(b)} title={b.title} data-kind={b.kind} data-testid="lib-vbar-related">
        <span className="lib-badge" data-kind={b.kind}>{badgeOf(b)}</span><span>{b.title}</span></button>)}
    </div>}
  </nav>;
}
