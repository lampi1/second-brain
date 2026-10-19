// A delegated chat as a thread-like card under its parent in the Grindhouse (ADR 0083): the task name first, then the
// role's character and English name, its state, a compact list of its latest steps (tool calls, newest at the bottom,
// live) and, once it reported, its result. A click anywhere opens the full chat in place (writable, like any strip;
// its chevron folds it back to the card). Also the fold toggle a parent shows above its children ("3 figlie · 2 al
// lavoro") and the limit a parent hit. Mounted by AgentStrips.tsx.
import { useEffect } from 'react';
import type { ChatItem } from '@shared/contract';
import { useApp, loadItems } from '../store/store';
import { setChatExpanded, setTreeCollapsed, ui } from '../store/ui';
import { sameList } from '../store/state';
import { t } from '../i18n';
import { AgentAvatar } from './AgentAvatar';
import { StatePill } from './ui';
import { IconChevronDown, IconChevronRight } from './Icons';
import '../styles/tree.css';

const STEPS = 4;
type Tool = Extract<ChatItem, { kind: 'tool' }>;
const EMPTY: Tool[] = [];
const stepsOf = (items: readonly ChatItem[] | undefined): Tool[] => {
  const tools = (items ?? []).filter((i): i is Tool => i.kind === 'tool');
  return tools.length ? tools.slice(-STEPS) : EMPTY;
};

export function DelegationCard({ chatId }: { chatId: string }) {
  const chat = useApp(s => s.chats[chatId]);
  const steps = useApp(s => stepsOf(s.items[chatId]), sameList);
  const loaded = useApp(s => !!s.items[chatId]);
  const parent = useApp(s => { const p = s.chats[chatId]?.parentId; return p ? s.chats[p]?.title ?? '' : ''; });
  useEffect(() => { if (!loaded) void loadItems(chatId); }, [chatId, loaded]);
  if (!chat) return null;
  const role = chat.agent?.name ?? chat.delegation?.role ?? '';
  const result = chat.delegation?.result;
  const open = () => setChatExpanded(chatId, true);
  return (
    <article className={`delegation-card${result ? ` is-${result.outcome}` : ''}`} data-testid={`delegation-card-${chatId}`} data-state={chat.state}
      onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }} tabIndex={0} role="button" aria-label={t('tree.open', { title: chat.title })}>
      <div className="dc-head">
        <h4 className="dc-title" title={chat.delegation?.goal ?? chat.title}>{chat.title}</h4>
        {result ? <span className={`pill dc-result is-${result.outcome}`} data-testid={`delegation-result-${chatId}`}>{t(`tree.result.${result.outcome}`)}</span> : <StatePill chat={chat} testid={`delegation-state-${chatId}`} />}
      </div>
      <div className="dc-who">
        <AgentAvatar avatar={chat.agent?.avatar} name={role} size={20} />
        <span className="dc-role">{role}</span>
        {parent && <span className="dc-parent">{t('tree.childOf', { title: parent })}</span>}
      </div>
      {result ? <p className="dc-summary">{result.summary}</p> : (
        <ol className="dc-steps" aria-label={t('tree.steps')}>
          {steps.length ? steps.map(s => <li key={s.id} className={`dc-step is-${s.status}`}><span className="dc-step-dot" aria-hidden="true" /><span className="dc-step-name">{s.name}</span><span className="dc-step-sum">{s.summary}</span></li>)
            : <li className="dc-step is-none">{t('tree.noSteps')}</li>}
        </ol>
      )}
    </article>
  );
}

/** The fold toggle above a parent's children, with how many there are and how many still work; the limit it hit. */
export function TreeToggle({ chatId, n, working }: { chatId: string; n: number; working: number }) {
  const folded = ui.use(s => s.prefs.treeCollapsed[chatId] === true);
  const title = useApp(s => s.chats[chatId]?.title ?? '');
  const limit = useApp(s => s.chats[chatId]?.limitHit);
  return (
    <div className="tree-toggle-row">
      <button type="button" className="tree-toggle" aria-expanded={!folded} data-testid={`tree-toggle-${chatId}`}
        aria-label={t(folded ? 'tree.unfold' : 'tree.fold', { title })} onClick={() => setTreeCollapsed(chatId, !folded)}>
        {folded ? <IconChevronRight size={13} /> : <IconChevronDown size={13} />}
        <span>{t('tree.children', { n, working })}</span>
      </button>
      {limit && <span className="pill pill-wait tree-limit" data-testid={`tree-limit-${chatId}`}>{t(`tree.limit.${limit.kind}`, { limit: limit.limit })}</span>}
    </div>
  );
}
