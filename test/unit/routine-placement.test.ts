// Routine identity keeps workers/descendants and their browsers out of the general workspace, including legacy runs.
import { expect, it } from 'vitest';
import type { BrowserTab, ChatSummary } from '../../src/shared/contract';
import type { FlowSnapshot } from '../../src/shared/flows';
import { routinePlacements, routineChatArg, readRoutineChatArg } from '../../src/renderer/lib/routine-chats';
import { workspaceTiles } from '../../src/renderer/lib/grid';
const c = (id: string, extra: Partial<ChatSummary> = {}) => ({ id, cwd: '/fixture', ...extra }) as ChatSummary;
it('removes fresh routine workers, nested delegates and owned browsers, retaining ordinary work', () => {
  const chats = { own: c('own', { routine: { runId: 'run', stepId: 'verify' } }), child: c('child', { parentId: 'own' }), work: c('work') };
  const placements = routinePlacements(chats); expect([...placements.keys()]).toEqual(['own', 'child']);
  const tabs = [{ id: 'routine-tab', ownerChatId: 'child' }, { id: 'work-tab', ownerChatId: 'work' }, { id: 'personal-tab' }] as BrowserTab[];
  expect(workspaceTiles(Object.keys(chats), chats, tabs)).toEqual([{ kind: 'chat', id: 'work' }, { kind: 'browser', id: 'work-tab' }, { kind: 'browser', id: 'personal-tab' }]);
});
it('recognizes old host bindings without hiding an unrelated task that reused a chat id', () => {
  const chats = { legacy: c('legacy', { run: { runId: 'bound' } as ChatSummary['run'] }), reused: c('reused', { run: { runId: 'new-task' } as ChatSummary['run'] }) };
  const snapshot = { runs: [{ id: 'run', steps: [{ stepId: 'check', chatId: 'legacy', chatRunId: 'bound' }, { stepId: 'later', chatId: 'reused', chatRunId: 'old-task' }] }] } as unknown as FlowSnapshot;
  expect([...routinePlacements(chats, snapshot).keys()]).toEqual(['legacy']);
  expect(readRoutineChatArg(routineChatArg('legacy', 'tab/one'))).toEqual({ chatId: 'legacy', tabId: 'tab/one' }); expect(readRoutineChatArg('chat:%')).toBeNull();
});
