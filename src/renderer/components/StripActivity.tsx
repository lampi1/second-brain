// The line of a collapsed agent strip while its chat works (ADR 0102): the current step read from the transcript at zero
// tokens (lib/strip-status.ts on lib/run-steps.ts: "Lancia `npm test`", "Modificati 4 file · +182 −64"), "passo 3/7"
// when the engine keeps a plan, and the silence ("da 6 min" on a tool still running, "ferma da 6 min" otherwise), amber
// once it passes the delegation stall threshold (Impostazioni → Ruoli e deleghe). Before any readable step it is the
// usual "sta pensando… / sta lavorando…". Mounted by ChatTile.tsx on every collapsed root strip; selectors read this
// chat only.
import { useMemo } from 'react';
import { useApp } from '../store/store';
import { useNow } from '../lib/clock';
import { stripStatus } from '../lib/strip-status';
import { t } from '../i18n';
import { turnActivity, Typing } from './ChatItems';

export function StripActivity({ chatId, testid }: { chatId: string; testid?: string }) {
  const items = useApp(s => s.items[chatId]);
  const stallMin = useApp(s => s.settings?.delegation?.stallMin ?? 10);
  const now = useNow(15_000);
  const st = useMemo(() => stripStatus(items, now, stallMin), [items, now, stallMin]);
  const what = turnActivity(items);
  if (!st.step && st.quietMin === null) return <Typing what={what} testid={testid} />;
  const parts: string[] = [];
  if (st.plan) parts.push(t('alive.step', st.plan));
  return <Typing what={what} testid={testid}>
    <span className="strip-step" data-testid={`strip-step-${chatId}`}>
      {st.step ? <span className="strip-step-text">{st.step.text}{st.step.code && <> <code>{st.step.code}</code></>}</span> : <span className="strip-step-text">{t(what === 'scrive' ? 'chat.items.typing.writing' : what === 'pensa' ? 'chat.items.typing.thinking' : 'chat.items.typing.working')}</span>}
      {parts.map(p => <span key={p} className="strip-step-plan" data-testid={`strip-plan-${chatId}`}> · {p}</span>)}
      {st.quietMin !== null && <span className={`strip-step-quiet${st.stalled ? ' is-stalled' : ''}`} data-testid={`strip-quiet-${chatId}`} data-stalled={st.stalled || undefined}
        {...(st.stalled ? { 'data-tip': t('alive.stalledTip', { min: stallMin }) } : {})}> · {t(st.toolRunning ? 'alive.toolFor' : 'alive.quiet', { min: st.quietMin })}</span>}
    </span>
  </Typing>;
}
