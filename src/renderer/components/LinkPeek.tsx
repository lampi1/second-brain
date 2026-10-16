// Clicks on the things inside a chat message (the user, 2026-10-13: "sempre il copia nelle cose copiabili o anteprime"):
// copyable `inline code` (marked data-copy by lib/markdown.ts) is copied with a short ✓; a file path in inline code and an
// http(s) link open a small popover instead: the file's first lines or its thumbnail (app:peekFile, main/peek-file.ts)
// with Apri and Copia; a link's address with "Apri nel browser dell'app" (a tab of the user's), "Apri fuori" and Copia.
// Ctrl+click on a link still opens it outside at once. Nothing opens or loads by itself, and a popover only shows on
// the user's click. Used by ChatItems.tsx (the list of a chat's items); pinned by test/e2e/link-peek.spec.ts.
import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { PeekResult } from '@shared/contract';
import { openInAppBrowser } from '../actions';
import { copyText } from '../brain/components/ui';
import { sb } from '../sb';
import { useApp } from '../store/store';
import { toast } from '../store/ui';
import { lineless } from '../lib/copyable';
import { t } from '../i18n';
import { openFile } from './GenUi';
import { IconCopy, IconFile, IconGlobe } from './Icons';
import { Popover } from './ui';

type Peek = { kind: 'link'; url: string } | { kind: 'file'; raw: string; res: PeekResult | null };

const COPIED_MS = 1200;

function flash(el: Element) {
  el.classList.add('copied');
  setTimeout(() => el.classList.remove('copied'), COPIED_MS);
}

const size = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n >= 1000 ? `${Math.round(n / 1000)} kB` : `${n} B`);

/** The click handler for a chat's list and the popover it opens (render `popover` once, next to the list). */
export function useLinkPeek(chatId: string | null) {
  const cwd = useApp(s => (chatId ? s.chats[chatId]?.cwd : undefined));
  const anchor = useRef<HTMLElement | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  const close = useCallback(() => setPeek(null), []);

  const onClick = useCallback((e: ReactMouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.md')) return;
    // a selection being made is not a click on the thing
    if (String(window.getSelection() ?? '').trim()) return;
    const code = target.closest<HTMLElement>('code[data-copy]');
    if (code) {
      const text = code.textContent ?? '';
      if (code.dataset.copy === 'path') {
        anchor.current = code;
        setPeek({ kind: 'file', raw: text, res: null });
        void sb.invoke('app:peekFile', { path: lineless(text), cwd }).then(res => setPeek(p => (p?.kind === 'file' && p.raw === text ? { ...p, res } : p)))
          .catch((err: unknown) => setPeek(p => (p?.kind === 'file' && p.raw === text ? { ...p, res: { kind: 'refused', reason: err instanceof Error ? err.message : String(err) } } : p)));
      } else {
        void copyText(text).then(ok => (ok ? flash(code) : toast(t('dialogs.linkPeek.copyError'), 'err')));
      }
      return;
    }
    const a = target.closest<HTMLAnchorElement>('a[href]');
    const url = a?.getAttribute('href') ?? '';
    if (!a || !/^https?:\/\//i.test(url) || e.ctrlKey || e.metaKey) return; // Ctrl+click: outside at once, as before
    e.preventDefault();
    anchor.current = a;
    setPeek({ kind: 'link', url });
  }, [cwd]);

  const popover = (
    <Popover key={peek?.kind === 'file' ? `${peek.raw}|${peek.res ? 1 : 0}` : peek?.url} anchor={anchor} open={!!peek} onClose={close} align="start" width={peek?.kind === 'file' ? 420 : 360} testid="peek">
      {peek?.kind === 'link' && <LinkBody url={peek.url} close={close} />}
      {peek?.kind === 'file' && <FileBody raw={peek.raw} res={peek.res} close={close} />}
    </Popover>
  );
  // the list scrolled by the user: the popover would float away from its line, so it closes
  const onWheel = useCallback(() => setPeek(p => (p ? null : p)), []);
  return { onClick, onWheel, popover };
}

function Act({ icon, children, onSelect, testid }: { icon: React.ReactNode; children: React.ReactNode; onSelect: () => void; testid: string }) {
  return <button type="button" role="menuitem" className="peek-act" onClick={onSelect} data-testid={testid}>{icon}{children}</button>;
}

function LinkBody({ url, close }: { url: string; close: () => void }) {
  let host = url;
  try { host = new URL(url).host; } catch { /* shown whole */ }
  return (
    <div className="peek">
      <div className="peek-head"><IconGlobe size={13} /><b>{host}</b></div>
      <div className="peek-url mono" data-testid="peek-url">{url}</div>
      <div className="peek-acts">
        <Act icon={<IconGlobe size={12} />} testid="peek-open-app" onSelect={() => {
          close();
          void openInAppBrowser(url);
        }}>{t('dialogs.linkPeek.openInApp')}</Act>
        <Act icon={<IconGlobe size={12} />} testid="peek-open-out" onSelect={() => { close(); window.open(url, '_blank', 'noopener'); }}>{t('dialogs.linkPeek.openOutside')}</Act>
        <Act icon={<IconCopy size={12} />} testid="peek-copy" onSelect={() => { close(); void copyText(url).then(ok => toast(ok ? t('dialogs.linkPeek.copyLinkSuccess') : t('dialogs.linkPeek.copyError'), ok ? 'ok' : 'err')); }}>{t('dialogs.linkPeek.copyLink')}</Act>
      </div>
    </div>
  );
}

function FileBody({ raw, res, close }: { raw: string; res: PeekResult | null; close: () => void }) {
  const full = res && 'path' in res ? res.path : raw;
  const name = full.split(/[\\/]/).pop() || full;
  const canOpen = res?.kind === 'text' || res?.kind === 'image' || res?.kind === 'other';
  return (
    <div className="peek">
      <div className="peek-head"><IconFile size={13} /><b title={full}>{name}</b>{res && 'size' in res && res.size > 0 && <span className="peek-size">{size(res.size)}</span>}</div>
      <div className="peek-url mono" title={full}>{full}</div>
      {!res && <div className="peek-note">{t('dialogs.linkPeek.readingFile')}</div>}
      {res?.kind === 'text' && <pre className="peek-text" data-testid="peek-text">{res.text}{res.more ? '\n…' : ''}</pre>}
      {res?.kind === 'image' && <img className="peek-img" src={res.dataUrl} alt={name} data-testid="peek-img" />}
      {res?.kind === 'other' && <div className="peek-note">{t('dialogs.linkPeek.noPreview', { what: res.what })}</div>}
      {(res?.kind === 'missing' || res?.kind === 'refused') && <div className="peek-note warn" data-testid="peek-note">{res.reason}</div>}
      <div className="peek-acts">
        {canOpen && <Act icon={<IconFile size={12} />} testid="peek-open-file" onSelect={() => { close(); void openFile(full); }}>{t('dialogs.linkPeek.openFile')}</Act>}
        <Act icon={<IconCopy size={12} />} testid="peek-copy" onSelect={() => { close(); void copyText(raw).then(ok => toast(ok ? t('dialogs.linkPeek.copyPathSuccess') : t('dialogs.linkPeek.copyError'), ok ? 'ok' : 'err')); }}>{t('dialogs.linkPeek.copyPath')}</Act>
      </div>
    </div>
  );
}
