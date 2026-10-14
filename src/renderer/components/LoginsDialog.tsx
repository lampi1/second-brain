// The "Credenziali" panel: every entry of the user's credentials file (brain ops/credentials.md), grouped as in the
// file ("air · test"), with a filter (every word must appear): user, note, "Apri" (the sign-in URL in a new internal browser tab of the user) and
// Copia for user and password. The password never reaches this page: main reads it from the file at the click and
// clears the clipboard after 30 s (credentials:copy, ADR 0012). Why: the user asked "dammi url e credenziali di test X"
// ~12 times in 6 days (2026-10-13). Opened from the command palette and the top bar; rendered by App.tsx (modal 'credentials').
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CredentialEntry } from '@shared/contract';
import { sb } from '../sb';
import { closeModal, setMaximized, setPair, toast, ui } from '../store/ui';
import { IconAlert, IconCheck, IconLogin, IconSearch, IconShield, IconSpinner } from './Icons';
import { Button, Keys, Modal } from './ui';

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

function CopyButton({ id, field, label, testid }: { id: string; field: 'user' | 'password'; label: string; testid: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const tip = field === 'password' ? 'Copia la password dal file delle credenziali; dagli appunti si cancella da sola dopo 30 secondi' : 'Copia il nome utente';
  const copy = async () => {
    let ok = false;
    try { ok = await sb.invoke('credentials:copy', { id, field }); } catch (e) { toast(`Copia non riuscita: ${errText(e)}`, 'err'); return; }
    if (!ok) { toast('Voce non trovata: il file delle credenziali è cambiato, riapri il pannello', 'err'); return; }
    setDone(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 2500);
  };
  return (
    <Button size="s" variant={done ? 'subtle' : 'ghost'} className={`ho-copy ${done ? 'copied' : ''}`} tip={tip} testid={testid} aria-label={`${label}${done ? ': copiato' : ''}`} onClick={() => void copy()}>
      {done ? <><IconCheck size={13} /> Copiata</> : label}
    </Button>
  );
}

/** The sign-in URL in a new tab of the user's, shown big (next to the chats in Corsie). */
async function openUrl(url: string): Promise<void> {
  try {
    const tab = await sb.invoke('browser:open', { url });
    closeModal();
    if (ui.get().prefs.view === 'corsie' && !ui.get().prefs.browsersHidden) setPair(tab.id); else setMaximized(`browser:${tab.id}`);
  } catch (e) { toast(`Pagina non aperta: ${errText(e)}`, 'err'); }
}

export function CredentialsDialog() {
  const [list, setList] = useState<CredentialEntry[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    let live = true;
    sb.invoke('credentials:list', undefined).then(x => { if (live) setList(x); }, e => { if (live) { setList([]); toast(`Credenziali non lette: ${errText(e)}`, 'err'); } });
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
    for (const e of shown) m.set(e.group || 'altro', [...(m.get(e.group || 'altro') ?? []), e]);
    return [...m.entries()];
  }, [shown]);
  return (
    <Modal onClose={closeModal} label="Credenziali" testid="credentials" className="modal-credentials">
      <div className="modal-head">
        <IconLogin size={16} />
        <h2>Credenziali</h2>
        <span className="modal-head-hint">dal file delle credenziali del tuo brain</span>
        <span className="sp" /><Keys combo="Esc" />
      </div>
      <div className="palette-search cred-search">
        <IconSearch size={16} />
        <input autoFocus value={q} placeholder="Filtra: test, prod, local…" aria-label="Filtra le credenziali" data-testid="credentials-filter" onChange={e => setQ(e.target.value)} />
      </div>
      <div className="modal-body cred-body" data-testid="credentials-list">
        {list === null ? <div className="handoff-empty"><IconSpinner size={18} /></div>
          : list.length === 0 ? (
            <div className="handoff-empty" data-testid="credentials-empty"><IconAlert size={18} />
              <p><b>Nessuna credenziale trovata.</b><br />Il pannello legge il file delle credenziali del brain (di solito ops/credentials.md): blocchi JSON con utente e password.</p></div>
          ) : shown.length === 0 ? <div className="palette-empty">Niente per «{q}».</div>
          : groups.map(([g, entries]) => (
            <section key={g} className="cred-group" aria-label={g}>
              <h3 className="cred-group-title">{g}</h3>
              {entries.map(e => (
                <div key={e.id} className="cred-entry" data-testid={`cred-${e.id}`}>
                  {e.note && <div className="cred-note" title={e.note}>{e.note}</div>}
                  <div className="cred-row">
                    <span className="ho-val" data-testid={`cred-user-${e.id}`}>{e.user}</span>
                    <CopyButton id={e.id} field="user" label="Copia utente" testid={`cred-copy-user-${e.id}`} />
                    <span className="ho-val ho-mask cred-mask" aria-label="password nascosta">••••••••</span>
                    <CopyButton id={e.id} field="password" label="Copia password" testid={`cred-copy-password-${e.id}`} />
                  </div>
                  {e.url && (
                    <div className="cred-row">
                      <span className="ho-val cred-url" title={e.url}>{e.url}</span>
                      <Button size="s" variant="ghost" className="ho-copy" tip="Apri l'indirizzo in una scheda del browser interno" testid={`cred-open-${e.id}`} onClick={() => void openUrl(e.url!)}>Apri</Button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}
      </div>
      <div className="modal-foot cred-foot">
        <span className="ho-safe"><IconShield size={13} /> La password non passa dallo schermo né dalle chat: si copia al clic e si cancella dagli appunti dopo 30 secondi</span>
      </div>
    </Modal>
  );
}
