// The "Credenziali" panel: every entry of the user's credentials file (brain ops/credentials.md), grouped as in the
// file ("air · test"), with a filter (every word must appear): user, note, "Apri" (the sign-in URL in a new internal browser tab of the user) and
// Copia for user and password. The password never reaches this page: main reads it from the file at the click and
// clears the clipboard after 30 s (credentials:copy, ADR 0012). Why: the user asked "dammi url e credenziali di test X"
// ~12 times in 6 days (2026-10-13). Opened from the command palette and the top bar; rendered by App.tsx (modal 'credentials').
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CredentialEntry } from '@shared/contract';
import { sb } from '../sb';
import { closeModal, setMaximized, toast } from '../store/ui';
import { t } from '../i18n';
import { IconAlert, IconCheck, IconLogin, IconSearch, IconShield, IconSpinner } from './Icons';
import { Button, Keys, Modal } from './ui';

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

function CopyButton({ id, field, label, testid }: { id: string; field: 'user' | 'password'; label: string; testid: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const tip = field === 'password' ? t('dialogs.handoffBanner.passwordCopyTip') : t('dialogs.handoffBanner.userCopyTip');
  const copy = async () => {
    let ok = false;
    try { ok = await sb.invoke('credentials:copy', { id, field }); } catch (e) { toast(t('dialogs.logins.copyError', { error: errText(e) }), 'err'); return; }
    if (!ok) { toast(t('dialogs.logins.notFound'), 'err'); return; }
    setDone(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 2500);
  };
  return (
    <Button size="s" variant={done ? 'subtle' : 'ghost'} className={`ho-copy ${done ? 'copied' : ''}`} tip={tip} testid={testid} aria-label={`${label}${done ? t('dialogs.handoffBanner.copiedAriaSuffix') : ''}`} onClick={() => void copy()}>
      {done ? <><IconCheck size={13} /> {t('dialogs.handoffBanner.copied')}</> : label}
    </Button>
  );
}

/** The sign-in URL in a new tab of the user's, shown big. */
async function openUrl(url: string): Promise<void> {
  try {
    const tab = await sb.invoke('browser:open', { url });
    closeModal();
    setMaximized(`browser:${tab.id}`);
  } catch (e) { toast(t('dialogs.logins.openPageError', { error: errText(e) }), 'err'); }
}

export function CredentialsDialog() {
  const [list, setList] = useState<CredentialEntry[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    let live = true;
    sb.invoke('credentials:list', undefined).then(x => { if (live) setList(x); }, e => { if (live) { setList([]); toast(t('dialogs.logins.readError', { error: errText(e) }), 'err'); } });
    return () => { live = false; };
  }, []);
  const shown = useMemo(() => {
    if (!list) return [];
    // every word must appear (a fuzzy match is too loose here: "sistema" would match "studio-demo")
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return list.filter(e => { const t = `${e.group} ${e.user} ${e.note ?? ''} ${e.url ?? ''}`.toLowerCase(); return words.every(w => t.includes(w)); });
  }, [list, q]);
  const groups = useMemo(() => {
    const m = new Map<string, CredentialEntry[]>();
    for (const e of shown) m.set(e.group || t('dialogs.logins.otherGroup'), [...(m.get(e.group || t('dialogs.logins.otherGroup')) ?? []), e]);
    return [...m.entries()];
  }, [shown]);
  return (
    <Modal onClose={closeModal} label={t('dialogs.logins.title')} testid="credentials" className="modal-credentials">
      <div className="modal-head">
        <IconLogin size={16} />
        <h2>{t('dialogs.logins.title')}</h2>
        <span className="modal-head-hint">{t('dialogs.logins.hint')}</span>
        <span className="sp" /><Keys combo="Esc" />
      </div>
      <div className="palette-search cred-search">
        <IconSearch size={16} />
        <input autoFocus value={q} placeholder={t('dialogs.logins.filterPlaceholder')} aria-label={t('dialogs.logins.filterLabel')} data-testid="credentials-filter" onChange={e => setQ(e.target.value)} />
      </div>
      <div className="modal-body cred-body" data-testid="credentials-list">
        {list === null ? <div className="handoff-empty"><IconSpinner size={18} /></div>
          : list.length === 0 ? (
            <div className="handoff-empty" data-testid="credentials-empty"><IconAlert size={18} />
              <p><b>{t('dialogs.logins.none')}</b><br />{t('dialogs.logins.noneDescription')}</p></div>
          ) : shown.length === 0 ? <div className="palette-empty">{t('dialogs.logins.noMatches', { q })}</div>
          : groups.map(([g, entries]) => (
            <section key={g} className="cred-group" aria-label={g}>
              <h3 className="cred-group-title">{g}</h3>
              {entries.map(e => (
                <div key={e.id} className="cred-entry" data-testid={`cred-${e.id}`}>
                  {e.note && <div className="cred-note" title={e.note}>{e.note}</div>}
                  <div className="cred-row">
                    <span className="ho-val" data-testid={`cred-user-${e.id}`}>{e.user}</span>
                    <CopyButton id={e.id} field="user" label={t('dialogs.logins.copyUserLabel')} testid={`cred-copy-user-${e.id}`} />
                    <span className="ho-val ho-mask cred-mask" aria-label={t('dialogs.handoffBanner.passwordHidden')}>••••••••</span>
                    <CopyButton id={e.id} field="password" label={t('dialogs.logins.copyPasswordLabel')} testid={`cred-copy-password-${e.id}`} />
                  </div>
                  {e.url && (
                    <div className="cred-row">
                      <span className="ho-val cred-url" title={e.url}>{e.url}</span>
                      <Button size="s" variant="ghost" className="ho-copy" tip={t('dialogs.logins.openTip')} testid={`cred-open-${e.id}`} onClick={() => void openUrl(e.url!)}>{t('dialogs.logins.openButton')}</Button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}
      </div>
      <div className="modal-foot cred-foot">
        <span className="ho-safe"><IconShield size={13} /> {t('dialogs.logins.passwordSafe')}</span>
      </div>
    </Modal>
  );
}
