// Frozen launch metadata shown on request; estimates and selection provenance are distinct from live token usage.
import type { ChatSummary } from '@shared/contract';
import { t } from '../i18n';
import { Modal } from './ui';
export function AgentContextInspector({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const context = chat.launchContext;
  return <Modal isolateWorkspace onClose={onClose} closeButton size="m" label={t('rt.context.title')} title={t('rt.context.title')} subtitle={chat.title} testid="agent-context-inspector">
    {!context ? <p>{t('rt.context.unknown')}</p> : <>
      <p>{t(context.mode === 'sealed' ? 'rt.context.sealed' : 'rt.context.scoped')}</p>
      <p><strong>≈ {context.instructions.estimatedTokens}</strong> {t('rt.context.tokens')} · {context.instructions.characters} {t('rt.context.characters')}</p>
      <p className="rt-muted">{t('rt.context.estimateHint')}</p>
      <h3>{t('rt.context.memory')}</h3>
      {context.memory.available ? <><p>{t('rt.context.selected', { n: context.memory.records.length })} · ≈ {context.memory.estimatedTokens}/{context.memory.budgetTokens} token</p>
        <dl><dt>{t('rt.context.ineligible')}</dt><dd>{context.memory.omitted.ineligible}</dd><dt>{t('rt.context.unmatched')}</dt><dd>{context.memory.omitted.unmatched}</dd><dt>{t('rt.context.budget')}</dt><dd>{context.memory.omitted.budget}</dd></dl>
        {context.memory.records.map(r => <details key={r.id}><summary>{r.id} · {r.status} · ≈ {r.estimatedTokens} token</summary><p>{t('rt.context.source')}: {r.sourceRunId ?? r.sourceEventId ?? '—'}</p><p>{t('rt.context.score')}: {r.score.toFixed(3)}</p></details>)}
      </> : <p>{t('rt.context.unavailable')}</p>}
      <h3>{t('rt.context.skills')}</h3>{context.skills.map(s => <p key={s.name}><strong>{s.name}</strong> · <code>{s.sha256.slice(0, 12)}</code></p>)}
      <details><summary>{t('rt.context.manifest')}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(context, null, 2)}</pre></details>
    </>}
  </Modal>;
}
