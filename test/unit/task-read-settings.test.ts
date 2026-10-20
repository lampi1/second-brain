// Task's reading settings in Settings → Notifiche (components/TaskReadSettings.tsx, ADR 0101): the automatic read, its
// interval and the alerts' sound as rows, from the tasks store; nothing before the first read.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { TasksState } from '../../src/shared/contract';

const mock = vi.hoisted(() => ({ state: null as unknown }));
vi.mock('../../src/renderer/store/tasks', () => ({ useTasks: (select: (s: unknown) => unknown) => select(mock.state), setTasks: vi.fn(), EVERY_CHOICES: [5, 15, 30, 60] }));
import { TaskReadSettings } from '../../src/renderer/components/TaskReadSettings';

it('renders nothing before the first read, then the three settings as rows', () => {
  expect(renderToStaticMarkup(createElement(TaskReadSettings))).toBe('');
  mock.state = { enabled: true, everyMin: 15, sound: false, nextAt: null } as unknown as TasksState;
  const html = renderToStaticMarkup(createElement(TaskReadSettings));
  expect(html).toContain('data-testid="task-auto"');
  for (const s of ['Aggiornamento automatico', 'Ogni quanti minuti', 'Suono degli avvisi', '15 min']) expect(html).toContain(s);
  mock.state = { enabled: false, everyMin: 7, sound: true, nextAt: null } as unknown as TasksState;
  expect(renderToStaticMarkup(createElement(TaskReadSettings))).toContain('7 min'); // an interval outside the choices is still said
});
