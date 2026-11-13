// Clicks on the things inside a chat message (the user, 2026-10-13: "sempre il copia nelle cose copiabili o anteprime"):
// copyable `inline code` (marked data-copy by lib/markdown.ts) is copied with a short ✓; a file path in inline code and an
// http(s) link open a small popover instead; a cited file opens the scoped Esplora viewer at its line.
// The link's address offers "Apri nel browser dell'app" (a tab of the user's), "Apri fuori" and Copia.
// Ctrl+click on a link still opens it outside at once. Nothing opens or loads by itself, and a popover only shows on
// the user's click. Used by ChatItems.tsx (the list of a chat's items); pinned by test/e2e/link-peek.spec.ts.
import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { openFileViewer, openInAppBrowser } from '../actions';
import { copyText } from '../brain/components/ui';
import { toast } from '../store/ui';
import { t } from '../i18n';
import { IconCopy, IconGlobe } from './Icons';
import { Popover } from './ui';

type Peek = { kind: 'link'; url: string };

const COPIED_MS = 1200;

function flash(el: Element) {
  el.classList.add('copied');
  setTimeout(() => el.classList.remove('copied'), COPIED_MS);
}

/** The click handler for a chat's list and the popover it opens (render `popover` once, next to the list). */
export function useLinkPeek(chatId: string | null) {
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
        openFileViewer(text,chatId??undefined);
      } else {
        void copyText(text).then(ok => (ok ? flash(code) : toast(t('dialogs.linkPeek.copyError'), 'err')));
      }
      return;
    }
    const a = target.closest<HTMLAnchorElement>('a[href]');
    const url = a?.getAttribute('href') ?? '';
    if(a&&url.startsWith('#sb-file=')){
      e.preventDefault();try{openFileViewer(decodeURIComponent(url.slice(9)),chatId??undefined);}catch{toast(t('viewer.missing'),'err');}return;
    }
    if (!a || !/^https?:\/\//i.test(url) || e.ctrlKey || e.metaKey) return; // Ctrl+click: outside at once, as before
    e.preventDefault();
    anchor.current = a;
    setPeek({ kind: 'link', url });
  }, [chatId]);

  const popover = (
    <Popover key={peek?.url} anchor={anchor} open={!!peek} onClose={close} align="start" width={360} testid="peek">
      {peek?.kind === 'link' && <LinkBody url={peek.url} close={close} />}
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

