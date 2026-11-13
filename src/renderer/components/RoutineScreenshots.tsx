// On-screen routine screenshots, lazy-loaded through the existing read-only file boundary. Old and live runs share
// this gallery. Explicit before/after names form pairs; clicking uses the app's full-size image viewer.
import { useEffect, useRef, useState } from 'react';
import type { RoutineRunRef } from '@shared/routines';
import { sb } from '../sb';
import { t } from '../i18n';

const name = (file: string) => file.split(/[\\/]/).pop() ?? file;
export function screenshotPairs(files: string[]): string[][] {
  const unique = [...new Set(files)], used = new Set<string>(), out: string[][] = [];
  const variant = (file: string, from: RegExp, to: string) => file.slice(0, file.length - name(file).length) + name(file).replace(from, `$1${to}`);
  const before = /(^|[-_. ])(before|prima)(?=[-_. ]|$)/i, after = /(^|[-_. ])(after|dopo)(?=[-_. ]|$)/i;
  for (const file of unique) {
    if (used.has(file)) continue;
    const isBefore = before.test(name(file)), isAfter = after.test(name(file));
    const other = isBefore ? variant(file, before, /prima/i.test(name(file)) ? 'dopo' : 'after')
      : isAfter ? variant(file, after, /dopo/i.test(name(file)) ? 'prima' : 'before') : undefined;
    const match = other && unique.find(f => f.toLowerCase() === other.toLowerCase() && !used.has(f));
    used.add(file);
    if (match) { used.add(match); out.push(isBefore ? [file, match] : [match, file]); } else out.push([file]);
  }
  return out;
}

function Shot({ file, revision, runRef, onOpenFile }: { file: string; revision?: string; runRef?: RoutineRunRef; onOpenFile(file: string): void }) {
  const ref = useRef<HTMLButtonElement>(null), [visible, setVisible] = useState(false), [data, setData] = useState<string>(), [error, setError] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setError(false);
    const read = runRef ? sb.invoke('routines:image', { ref: { source: runRef.source, routineId: runRef.routineId, runId: runRef.runId }, path: file }) : sb.invoke('app:readFile', { path: file });
    void read.then(value => { if (alive) { if (value.kind === 'image') setData(value.dataUrl); else { setData(undefined); setError(true); } } }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [file, visible, revision, runRef?.source, runRef?.routineId, runRef?.runId]);
  return <button ref={ref} type="button" className="rs-shot" onClick={() => onOpenFile(file)} title={name(file)}>
    {data && <img src={data} alt={name(file)} loading="lazy" />}<span>{name(file)}{error ? ` · ${t('rs.imageUnavailable')}` : ''}</span>
  </button>;
}
export function RoutineScreenshots({ files, revisions = {}, runRef, onOpenFile }: { files: string[]; revisions?: Record<string, string>; runRef?: RoutineRunRef; onOpenFile(file: string): void }) {
  if (!files.length) return null;
  return <div className="rs-gallery" aria-label={t('rs.screenshots')}>
    {screenshotPairs(files).map(pair => <div className="rs-shot-pair" key={pair[0]} data-testid={pair.length === 2 ? 'run-shot-pair' : 'run-shot'}>
      {pair.map(file => <Shot key={file} file={file} revision={revisions[file]} runRef={runRef} onOpenFile={onOpenFile} />)}
    </div>)}
  </div>;
}
