// The stand-up box of Fatto and Task: 3-5 sentences to read aloud about the last work day and today, with Copia.
// Data: /api/day (report and brief, from the brain's day tool) and /api/tables. Used by pages/Fatto.tsx and pages/Task.tsx.
import { normBrief, normReport, type Tables } from '../types';
import { useBrain, combine } from '../api';
import { lastDiaryDay, standupText } from '../lib/text';
import { dayName } from '../lib/format';
import { Async, NoDevops } from '../components/States';
import { copyText, IconCopy, toast } from '../components/ui';
import { t } from '../../i18n';

/** The stand-up box: the last work day and today, in sentences to read aloud. */
export function Standup({ tables, owner }: { tables: Tables; owner: string }) {
  const prev = lastDiaryDay(tables.journal, tables.today);
  const rep = useBrain(`/api/day?kind=report&date=${prev}`, normReport);
  const br = useBrain('/api/day?kind=brief', normBrief);
  const st = combine(rep, br);
  const text = rep.data && br.data ? standupText(rep.data, br.data, owner) : '';
  return (
    <section className="bx-card bx-standup bx-section" aria-labelledby="bx-standup-h" data-testid="bx-standup">
      <div className="bx-section-head">
        <h2 id="bx-standup-h">{t('brainPages.day.standupTitle')}</h2>
        <p>{dayName(prev, tables.today).toLowerCase()} {t('brainPages.day.standupDesc')}</p>
        <span className="sp" />
        {text && <button type="button" className="bx-btn s" onClick={() => void copyText(text).then(ok => toast(ok ? t('brainPages.day.copied') : t('brainPages.day.copyFailed')))}><IconCopy /> {t('brainPages.day.copyBtn')}</button>}
      </div>
      <Async loading={st.loading} error={st.error} onRetry={() => { rep.reload(); br.reload(); }} label={t('brainPages.day.loading')} lines={3}>
        {() => (
          <>
            {(rep.data?.devops === false || br.data?.devops === false) && <NoDevops />}
            <div className="lines">{text.split('\n').map((s, i) => <p key={i}>{s}</p>)}</div>
            <p className="small muted">{t('brainPages.day.note', { hasDevops: rep.data?.devops !== false })}</p>
          </>
        )}
      </Async>
    </section>
  );
}
