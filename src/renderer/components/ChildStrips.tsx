// The sub-agents of a chat as indented strips under it (Brother, 18/10: «ogni sottoagente o agente che gira deve essere
// visibile»): one short row per child the engine reported (Claude's Agent/Task tools and background tasks, Codex's
// sub-agents, Cursor's task tool: main/chats/agent-children.ts collects them, the chat's agentChildren carries them),
// with what it does, its state and when it started. A running child always shows; an ended one keeps its final state,
// the older finished ones fold behind "altri N finiti" (lib/agent-children.ts). Mounted under each strip of the
// Grindhouse (AgentStrips.tsx) and under the Orchestrator's head (RegiaTile.tsx). The "Dettagli" popover
// (AgentIdentity.tsx) keeps the full census with the parent links.
import { useState } from 'react';
import { childRows, childTone } from '../lib/agent-children';
import { minutes } from '../lib/format';
import { useNow } from '../lib/clock';
import { useApp } from '../store/store';
import { locale, t } from '../i18n';

const timeOf = (at: number) => new Intl.DateTimeFormat(locale(), { timeStyle: 'short' }).format(at);

export function ChildStrips({ chatId }: { chatId: string }) {
  const children = useApp(s => s.chats[chatId]?.agentChildren);
  const title = useApp(s => s.chats[chatId]?.agent?.name || s.chats[chatId]?.title || '');
  const [all, setAll] = useState(false);
  const now = useNow(15_000); // a running child's duration grows on screen
  if (!children?.children.length) return null;
  const folded = childRows(children, false);
  const { rows, hiddenEnded } = all ? childRows(children, true) : folded;
  if (!rows.length) return null;
  return <div className="child-strips" role="list" aria-label={t('product.childrenOf', { title })} data-testid={`child-strips-${chatId}`} data-active={rows.filter(r => r.active).length}>
    {rows.map(r => {
      const tone = childTone(r.state);
      const since = r.active ? t('product.childFor', { d: minutes(Math.max(0, now - r.startedAt)) }) : null;
      return <div role="listitem" className={`child-strip${r.active ? ' is-active' : ' is-ended'}`} key={r.key} data-testid="child-strip" data-child-key={r.key} data-child-state={r.state} data-child-kind={r.kind}
        title={[r.task, t('product.childStarted', { time: timeOf(r.startedAt) }), r.source === 'replay' ? t('product.replayed') : null].filter(Boolean).join(' · ')}>
        <span className="child-strip-mark" aria-hidden="true">↳</span>
        <span className="child-strip-kind">{t(`product.child.${r.kind}`)}</span>
        <span className="child-strip-task">{r.task || t('product.noTask')}</span>
        <span className={`pill pill-${tone} child-strip-state`} data-testid="child-state">{(tone === 'run' || tone === 'wait') && <span className="pill-dot" aria-hidden="true" />}{t(`product.${r.state}`)}</span>
        <span className="child-strip-time" data-testid="child-time"><time dateTime={new Date(r.startedAt).toISOString()}>{timeOf(r.startedAt)}</time>{since ? ` · ${since}` : ''}</span>
      </div>;
    })}
    {hiddenEnded > 0 && <button type="button" className="link-btn child-strips-more" onClick={() => setAll(true)} data-testid={`child-strips-more-${chatId}`}>{t('product.childrenMoreEnded', { n: hiddenEnded })}</button>}
    {all && folded.hiddenEnded > 0 && <button type="button" className="link-btn child-strips-more" onClick={() => setAll(false)} data-testid={`child-strips-less-${chatId}`}>{t('product.childrenHideEnded')}</button>}
  </div>;
}
