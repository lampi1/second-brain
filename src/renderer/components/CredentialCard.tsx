// The Orchestrator's credentials card (ADR 0367, owner 2026-11-27: «dammi le credenziali di test 3»): URL / Utente /
// Password rows of one entry of the user's credentials file, each with its own «Copia»; the password masked until
// «Mostra». The chat item holds only the entry's id and group (app_show_credentials, main/appctl/credential-card-tool.ts):
// the values come from main (credentials:card, credentials:reveal) only while the card is live and live only in this
// component's state; «Copia» asks main to write that one field to the clipboard, only on the click (a password goes
// back off it after 30 s). The card hides itself 10 minutes after it was shown and forgets the values. Used by
// ChatItems.tsx (system items with code credentialCard). Every value carries oc-cred-val: app_screenshot hides them
// before it captures the window (main/appctl/ui-shot-mask.ts).
import { useEffect, useState } from 'react';
import type { ChatItem } from '@shared/contract';
import { cardMinutesLeft } from '@shared/credential-card';
import { sb } from '../sb';
import { useTick } from '../lib/use-tick';
import { t } from '../i18n';
import { IconCheck, IconKey } from './Icons';

type Sys = Extract<ChatItem, { kind: 'system' }>;
type Field = 'url' | 'user' | 'password';
const MASK = '••••••••••••';

export function CredentialCard({ item }: { item: Sys }) {
  const id = typeof item.params?.entryId === 'string' ? item.params.entryId : '';
  const group = typeof item.params?.group === 'string' ? item.params.group : '';
  const now = useTick(15_000);
  const left = cardMinutesLeft(item.at, now);
  const [fields, setFields] = useState<{ user: string; url?: string } | null | 'loading'>('loading');
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState<Field | null>(null);
  useEffect(() => {
    if (!id || left === 0) { setFields(null); return; }
    let alive = true;
    void sb.invoke('credentials:card', { id }).then(f => { if (alive) setFields(f); }, () => { if (alive) setFields(null); });
    return () => { alive = false; };
  }, [id, left === 0]);
  // hidden: the values leave the component's state
  useEffect(() => { if (left === 0) { setPassword(null); setFields(null); } }, [left]);
  useEffect(() => { if (!copied) return; const h = setTimeout(() => setCopied(null), 1500); return () => clearTimeout(h); }, [copied]);
  if (left === 0) {
    return <div className="oc-evt oc-cred-closed" data-testid="credential-card-closed"><IconKey size={13} /><span className="oc-grow">{t('chat.cred.closed', { group })}</span></div>;
  }
  const copy = (field: Field) => { void sb.invoke('credentials:copy', { id, field }).then(ok => { if (ok) setCopied(field); }); };
  const reveal = () => {
    if (password !== null) { setPassword(null); return; }
    void sb.invoke('credentials:reveal', { id }).then(pw => setPassword(pw));
  };
  const copyBtn = (field: Field) => (
    <button type="button" className="oc-copy" onClick={() => copy(field)} data-testid={`credential-copy-${field}`}>
      {copied === field ? <><IconCheck size={11} /> {t('chat.cred.copied')}</> : t('chat.cred.copy')}
    </button>
  );
  const f = fields === 'loading' ? null : fields;
  return (
    <div className="oc-card oc-cred" role="group" aria-label={t('chat.cred.title', { group })} data-testid="credential-card">
      <div className="oc-row"><span className="oc-who oc-grow">{t('chat.cred.title', { group })}</span><span className="oc-who">{t('chat.cred.closesIn', { min: left })}</span></div>
      {fields === null ? <span className="oc-src" data-testid="credential-card-missing">{t('chat.cred.missing')}</span> : (
        <div className="oc-kvc">
          <span>{t('chat.cred.url')}</span><code className="oc-cred-val" data-testid="credential-url">{f?.url ?? '—'}</code>{f?.url ? copyBtn('url') : <span />}
          <span>{t('chat.cred.user')}</span><code className="oc-cred-val" data-testid="credential-user">{f?.user ?? '…'}</code>{copyBtn('user')}
          <span>{t('chat.cred.password')}</span><code className="oc-pw oc-cred-val" data-testid="credential-password">{password ?? MASK}</code>
          <span className="oc-row oc-tight">
            <button type="button" className="oc-copy" onClick={reveal} aria-pressed={password !== null} data-testid="credential-show">{password !== null ? t('chat.cred.hide') : t('chat.cred.show')}</button>
            {copyBtn('password')}
          </span>
        </div>
      )}
      <span className="oc-src">{t('chat.cred.note')}</span>
    </div>
  );
}
