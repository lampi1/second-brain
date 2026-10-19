// Settings → Il mio spazio, the projects folder row (src/renderer/components/ProjectsFolderSetting.tsx): it shows the
// saved folder or "to set later", the "Cambia…" and "Rileva di nuovo" buttons and the "?" explanation; rendering it
// changes no setting. SSR only (no window, so no IPC can run), mocked store.
import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { setLang } from '../../src/renderer/i18n';
const mock = vi.hoisted(() => ({ state: {} as Record<string, unknown>, setSetting: vi.fn() }));
vi.mock('../../src/renderer/store/store', () => ({ useApp: (select: (state: Record<string, unknown>) => unknown) => select(mock.state), setSetting: mock.setSetting }));
vi.mock('../../src/renderer/store/ui', () => ({ toast: vi.fn() }));

import { ProjectsFolderSetting } from '../../src/renderer/components/ProjectsFolderSetting';

beforeEach(() => { setLang('it'); mock.setSetting.mockClear(); });

it('shows the saved projects folder with Cambia, Rileva di nuovo and the explanation', () => {
  mock.state = { settings: { projectsRoot: '/srv/code/repos' } };
  const html = renderToStaticMarkup(createElement(ProjectsFolderSetting));
  expect(html).toContain('Cartella dei progetti');
  expect(html).toContain('/srv/code/repos');
  expect(html).toContain('Cambia…');
  expect(html).toContain('Rileva di nuovo');
  expect(html).toContain('st-help-projects');
  expect(mock.setSetting).not.toHaveBeenCalled();
});

it('says the folder is still to set when none is saved', () => {
  mock.state = { settings: { projectsRoot: null } };
  expect(renderToStaticMarkup(createElement(ProjectsFolderSetting))).toContain('Da indicare più avanti');
});
