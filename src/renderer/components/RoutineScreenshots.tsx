// On-screen routine screenshots, lazy-loaded through the existing read-only file boundary. Old and live runs share
// this gallery. Explicit before/after names form pairs; clicking uses the app's full-size image viewer.
import { useEffect, useRef, useState } from 'react';
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

function Shot({ file, onOpenFile }: { file: string; onOpenFile(file: string): void }) {
  const ref = useRef<HTMLButtonElement>(null), [visible, setVisible] = useState(false), [data, setData] = useState<string>();
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void sb.invoke('app:readFile', { path: file }).then(value => { if (alive && value.kind === 'image') setData(value.dataUrl); }).catch(() => {});
    return () => { alive = false; };
  }, [file, visible]);
  return <button ref={ref} type="button" className="rs-shot" onClick={() => onOpenFile(file)} title={name(file)}>
    {data && <img src={data} alt={name(file)} loading="lazy" />}<span>{name(file)}</span>
  </button>;
}
export function RoutineScreenshots({ files, onOpenFile }: { files: string[]; onOpenFile(file: string): void }) {
  if (!files.length) return null;
  return <div className="rs-gallery" aria-label={t('rs.screenshots')}>
    {screenshotPairs(files).map(pair => <div className="rs-shot-pair" key={pair[0]} data-testid={pair.length === 2 ? 'run-shot-pair' : 'run-shot'}>
      {pair.map(file => <Shot key={file} file={file} onOpenFile={onOpenFile} />)}
    </div>)}
  </div>;
}
