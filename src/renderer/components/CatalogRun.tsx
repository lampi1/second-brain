// Catalog launch composer and success feedback. A run starts only after the user supplies its goal and folder.
import { useEffect, useRef, useState } from 'react';
import type { AgentProfile } from '@shared/agents';
import { createChat, useApp } from '../store/store';
import { toast } from '../store/ui';
import { focusChat, regiaId } from '../actions';
import { t } from '../i18n';

export function CatalogRun({ profile, available }: { profile: AgentProfile; available: boolean }) {
  const root = useApp(s => s.info?.brainRoot);
  const [open, setOpen] = useState(false), [goal, setGoal] = useState(''), [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [started, setStarted] = useState(false), [error, setError] = useState(false);
  const working = useRef(false);
  useEffect(() => { if (!started) return; const timer = setTimeout(() => setStarted(false), 1600); return () => clearTimeout(timer); }, [started]);
  const start = async () => {
    const cwd = (folder ?? root)?.trim();
    if (working.current || !available || !goal.trim() || !cwd) return;
    working.current = true; setBusy(true); setError(false);
    try {
      const owner = regiaId();
      const chat = await createChat({ agentId: profile.id, harness: profile.engine, cwd, prompt: goal.trim(), ...(owner ? { regiaOf: owner } : {}) });
      if (!chat) { setError(true); return; }
      setStarted(true); setOpen(false); setGoal('');
      toast(t('runs.started'), 'ok', { label: t('runs.open'), run: () => focusChat(chat.id) });
    } finally { working.current = false; setBusy(false); }
  };
  return <div className="catalog-run">
    <button type="button" className={`btn btn-primary${started ? ' run-confirmed' : ''}`} disabled={!available || busy} aria-expanded={open}
      onClick={() => setOpen(v => !v)} data-testid={`catalog-run-${profile.id}`}>
      <span className="run-mark" aria-hidden="true">{started ? '✓' : '▶'}</span> {t(started ? 'runs.startedShort' : 'runs.run')}</button>
    {open && <form onSubmit={e => { e.preventDefault(); void start(); }} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void start(); } }}>
      <label className="field"><span>{t('runs.goal')}</span><textarea autoFocus required maxLength={2000} value={goal} disabled={busy} onChange={e => setGoal(e.target.value)} /></label>
      <label className="field"><span>{t('runs.folder')}</span><input required value={folder ?? root ?? ''} disabled={busy} onChange={e => setFolder(e.target.value)} /></label>
      {error && <p role="alert">{t('runs.startError')}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy || !goal.trim() || !(folder ?? root)?.trim()}>{t(busy ? 'start.starting' : 'runs.run')}</button>
    </form>}
  </div>;
}
