// The hand-off banner on a browser tile: its chat waits for the user to act in this tab (a login, MFA, a CAPTCHA). It
// says who waits and since when, the agent's instructions, and for a login the account from the user's credentials
// file (sign-in URL, user name, a masked password) with Copia buttons; the password is copied by main and never
// reaches this page. Fatto / Non riesco answer the waiting agent (or wake its chat: browser/service.ts).
// Why: the user missed a login request whose credentials the chat had written only in its reasoning (2026-10-11).
// Used by BrowserTile.tsx.
import { useEffect, useRef, useState } from 'react';
import type { BrowserHandoff } from '@shared/contract';
import { ago } from '../lib/format';
import { useNow } from '../lib/clock';
import { copyFromHandoff, resolveHandoff } from '../store/handoffs';
import { navigateTab } from '../store/store';
import { t } from '../i18n';
import { IconAlert, IconCheck, IconLogin, IconShield } from './Icons';
import { Button } from './ui';

function CopyButton({ id, field, label, testid }: { id: string; field: 'user' | 'password'; label: string; testid: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const tip = field === 'password' ? t('dialogs.handoffBanner.passwordCopyTip') : t('dialogs.handoffBanner.userCopyTip');
  return (
    <Button size="s" variant={done ? 'subtle' : 'ghost'} className={`ho-copy ${done ? 'copied' : ''}`} tip={tip} testid={testid} aria-label={`${label}${done ? t('dialogs.handoffBanner.copiedAriaSuffix') : ''}`}
      onClick={() => void copyFromHandoff(id, field).then(ok => {
        if (!ok) return;
        setDone(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), 2500);
      })}>
      {done ? <><IconCheck size={13} /> {t('dialogs.handoffBanner.copied')}</> : t('dialogs.handoffBanner.copyButton')}
    </Button>
  );
}

export function HandoffBanner({ h, chatTitle }: { h: BrowserHandoff; chatTitle: string | null }) {
  const now = useNow(15_000);
  const a = h.account;
  const login = h.kind === 'login';
  const signIn = a?.url && a.url !== h.url ? a.url : null;
  return (
    <div className={`handoff ${login ? 'is-login' : ''}`} role="alert" aria-label={t('dialogs.handoffBanner.askAria', { who: chatTitle ?? t('dialogs.handoffBanner.anAgent'), reason: h.reason })} data-testid={`handoff-${h.tabId}`}>
      <div className="ho-head">
        <span className="ho-icon" aria-hidden="true">{login ? <IconLogin size={16} /> : <IconAlert size={16} />}</span>
        <div className="ho-titles">
          <b className="ho-title">{h.reason}</b>
          <span className="ho-sub">{chatTitle ? <><span className="ho-who">{chatTitle}</span>{t('dialogs.handoffBanner.waitingSuffix')}</> : `${t('dialogs.handoffBanner.anAgent')}${t('dialogs.handoffBanner.waitingSuffix')}`} · {ago(h.at, now) === t('appText.format.now') ? t('dialogs.handoffBanner.justNow') : t('dialogs.handoffBanner.sinceTime', { time: ago(h.at, now) })}{h.env ? <> · {t('dialogs.handoffBanner.envLabel')} <span className="ho-env">{h.env}</span></> : null}</span>
        </div>
      </div>
      {h.instructions && <p className="ho-text" data-testid={`handoff-text-${h.tabId}`}>{h.instructions}</p>}
      {a && (
        <dl className="ho-cred" data-testid={`handoff-account-${h.tabId}`}>
          {signIn && (<>
            <dt>{t('dialogs.handoffBanner.address')}</dt>
            <dd><span className="ho-val" title={signIn}>{signIn}</span>
              <Button size="s" variant="ghost" className="ho-copy" tip={t('dialogs.handoffBanner.openAddressTip')} testid={`handoff-open-${h.tabId}`} onClick={() => void navigateTab(h.tabId, signIn)}>{t('dialogs.logins.openButton')}</Button></dd>
          </>)}
          <dt>{t('dialogs.handoffBanner.user')}</dt>
          <dd><span className="ho-val" data-testid={`handoff-user-${h.tabId}`}>{a.user}</span><CopyButton id={h.id} field="user" label={t('dialogs.logins.copyUserLabel')} testid={`handoff-copy-user-${h.tabId}`} /></dd>
          <dt>{t('dialogs.handoffBanner.password')}</dt>
          <dd>{a.found
            ? <><span className="ho-val ho-mask" aria-label={t('dialogs.handoffBanner.passwordHidden')}>••••••••••</span><CopyButton id={h.id} field="password" label={t('dialogs.logins.copyPasswordLabel')} testid={`handoff-copy-password-${h.tabId}`} /></>
            : <span className="ho-missing" data-testid={`handoff-missing-${h.tabId}`}><IconAlert size={13} /> {t('dialogs.handoffBanner.notInCredentials')}</span>}</dd>
          {a.note && <dd className="ho-note">{a.note}</dd>}
        </dl>
      )}
      <div className="ho-actions">
        <Button size="s" variant="primary" testid={`handoff-done-${h.tabId}`} onClick={() => void resolveHandoff(h, 'done')}>
          <IconCheck size={14} /> {login ? t('dialogs.handoffBanner.loginDone') : t('dialogs.handoffBanner.done')}
        </Button>
        <Button size="s" variant="subtle" testid={`handoff-failed-${h.tabId}`} onClick={() => void resolveHandoff(h, 'failed')}>{t('dialogs.handoffBanner.failed')}</Button>
        {login && <span className="ho-safe"><IconShield size={13} /> {t('dialogs.handoffBanner.passwordSafe')}</span>}
      </div>
    </div>
  );
}
