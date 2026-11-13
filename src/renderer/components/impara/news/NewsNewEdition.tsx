// «Nuova edizione» of the «Giornale» (ADR 0279): a name and one sentence on what the user wants from it, then three
// ways to make it. «Trova le fonti con l'Orchestrator» hands both to the Orchestrator, which looks for the best
// sources, tries each one live, builds the edition with its sections and says what it left out (the default: nobody
// should have to hunt for feeds). «Crea vuota» makes the edition now, for the user's own links. A ready-made edition
// (today «AI per chi costruisce agenti», with the sources of ADR 0265) is one click. `first`: the page's empty state on
// a clean install (inline, no dialog). Used by NewsPage.tsx; styles news.css (.nwn-*).
import { useState } from 'react';
import { askEdition, editEdition, news } from '../../../lib/news';
import { toast } from '../../../store/ui';
import { t } from '../../../i18n';
import { Button, Modal } from '../../ui';
import { IconSparkle } from '../../Icons';

export function NewsNewEdition({ first, onClose, onCreated }: { first?: boolean; onClose?: () => void; onCreated?: (id: string) => void }) {
  const state = news.use(s => s.state);
  const [name, setName] = useState('');
  const [interest, setInterest] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = name.trim().length > 0;
  const made = (before: readonly string[], after: readonly { id: string }[] | undefined) => { const id = after?.find(e => !before.includes(e.id))?.id; if (id) onCreated?.(id); };
  const ids = () => state?.editions.map(e => e.id) ?? [];
  const create = async (template?: string) => {
    if (busy) return;
    setBusy(true);
    const before = ids();
    const s = await editEdition(template ? { op: 'create', name: '', template } : { op: 'create', name: name.trim(), interest: interest.trim() });
    setBusy(false);
    if (s) made(before, s.editions);
  };
  const ask = () => {
    if (!ok) return;
    if (!askEdition(name, interest)) { toast(t('news.new.noOrchestrator'), 'warn'); return; }
    toast(t('news.new.asked', { name: name.trim() }), 'ok');
    onClose?.();
  };
  const body = (
    <div className="nwn" data-testid="news-new">
      <label className="nwn-f">{t('news.new.name')}
        <input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder={t('news.new.namePh')} data-testid="news-new-name" autoFocus={!first} />
      </label>
      <label className="nwn-f">{t('news.new.interest')}
        <textarea value={interest} onChange={e => setInterest(e.target.value)} maxLength={400} rows={3} placeholder={t('news.new.interestPh')} data-testid="news-new-interest" />
      </label>
      <div className="nwn-acts">
        <Button variant="primary" onClick={ask} disabled={!ok || busy} testid="news-new-ask"><IconSparkle size={13} />{t('news.new.ask.button')}</Button>
        <Button onClick={() => void create()} disabled={!ok || busy} testid="news-new-empty">{t('news.new.empty')}</Button>
      </div>
      <p className="nwn-note">{t('news.new.askHint')}</p>
      {(state?.templates.length ?? 0) > 0 && (
        <div className="nwn-tpl">
          <div className="nw-lbl">{t('news.new.templates')}</div>
          {state!.templates.map(tp => (
            <button key={tp.id} type="button" onClick={() => void create(tp.id)} disabled={busy} data-testid={`news-template-${tp.id}`}>
              <b>{tp.name}</b><span>{t('news.new.templateSources', { n: tp.sources })}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
  if (first) return (
    <div className="nw-empty nw-first" data-testid="news-first">
      <h2>{t('news.first.title')}</h2>
      <p>{t('news.first.body')}</p>
      {body}
    </div>
  );
  return <Modal onClose={() => onClose?.()} label={t('news.new.title')} title={t('news.new.title')} subtitle={t('news.new.lead')} closeButton testid="news-new-modal">{body}</Modal>;
}
