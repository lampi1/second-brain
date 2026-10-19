// The sub-agents of a chat as indented strips under it (Brother, 18/10: «ogni sottoagente o agente che gira deve essere
// visibile»): one short row per child the engine reported (Claude's Agent/Task tools and background tasks, Codex's
// sub-agents, Cursor's task tool: main/chats/agent-children.ts collects them, the chat's agentChildren carries them),
// with the app agent it runs as (the catalog profile its engine agent type names, else "nessun agente"; owner, #69),
// what it does, its state and when it started. A child at work always shows; an ended one leaves at once
// (lib/agent-children.ts), so the strips stay short. Mounted under each strip of the
// Grindhouse (AgentStrips.tsx) and under the Orchestrator's head (RegiaTile.tsx). The "Dettagli" popover
// (AgentIdentity.tsx) keeps the full census with the parent links.
import type { AgentProfile } from '@shared/agents';
import { childAgent, childRows, childTone } from '../lib/agent-children';
import { useAgents } from '../store/agents';
import { AgentAvatar } from './AgentAvatar';
import { minutes } from '../lib/format';
import { useNow } from '../lib/clock';
import { useApp } from '../store/store';
import { locale, t } from '../i18n';

const timeOf = (at: number) => new Intl.DateTimeFormat(locale(), { timeStyle: 'short' }).format(at);

export function ChildStrips({ chatId }: { chatId: string }) {
  const children = useApp(s => s.chats[chatId]?.agentChildren);
  const title = useApp(s => s.chats[chatId]?.agent?.name || s.chats[chatId]?.title || '');
  const now = useNow(15_000); // a running child's duration grows on screen
  const profiles = useAgents().catalog?.profiles;
  if (!children?.children.length) return null;
  const { rows } = childRows(children);
  if (!rows.length) return null;
  return <div className="child-strips" role="list" aria-label={t('product.childrenOf', { title })} data-testid={`child-strips-${chatId}`} data-active={rows.filter(r => r.active).length}>
    {rows.map(r => {
      const tone = childTone(r.state);
      const since = r.active ? t('product.childFor', { d: minutes(Math.max(0, now - r.startedAt)) }) : null;
      return <div role="listitem" className={`child-strip${r.active ? ' is-active' : ' is-ended'}`} key={r.key} data-testid="child-strip" data-child-key={r.key} data-child-state={r.state} data-child-kind={r.kind}
        title={[r.task, t('product.childStarted', { time: timeOf(r.startedAt) }), r.source === 'replay' ? t('product.replayed') : null].filter(Boolean).join(' · ')}>
        <span className="child-strip-mark" aria-hidden="true">↳</span>
        <span className="child-strip-kind">{t(`product.child.${r.kind}`)}</span>
        {r.kind !== 'shell' && <ChildAgent agentType={r.agentType} profiles={profiles} />}
        <span className="child-strip-task">{r.task || t('product.noTask')}</span>
        <span className={`pill pill-${tone} child-strip-state`} data-testid="child-state">{(tone === 'run' || tone === 'wait') && <span className="pill-dot" aria-hidden="true" />}{t(`product.${r.state}`)}</span>
        <span className="child-strip-time" data-testid="child-time"><time dateTime={new Date(r.startedAt).toISOString()}>{timeOf(r.startedAt)}</time>{since ? ` · ${since}` : ''}</span>
      </div>;
    })}
  </div>;
}

/** The app agent a sub-agent runs as, with its face; "nessun agente" when its engine type names no catalog agent. */
function ChildAgent({ agentType, profiles }: { agentType: string | null; profiles: readonly AgentProfile[] | undefined }) {
  const agent = childAgent(agentType, profiles);
  if (!agent) return <span className="child-strip-agent is-none" data-testid="child-agent" data-agent-type={agentType ?? undefined}>{t('product.childNoAgent')}</span>;
  return <span className="child-strip-agent" data-testid="child-agent" data-agent-id={agent.id}><AgentAvatar avatar={agent.avatar} name={agent.name} size={16} />{agent.name}</span>;
}
