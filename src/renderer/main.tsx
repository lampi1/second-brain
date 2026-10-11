// Renderer entry. The app page: starts the data store, the browser-view reporter, the global-layer sync and the
// main→UI command listeners, then mounts App.tsx. The same bundle with #overlay is the global request layer page
// (main/overlay.ts): it mounts OverlayApp.tsx only; with #brain-test/<page> it shows a brain page alone (the test
// route of brain/testRoute.tsx).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { sb } from './sb';
import { startViewports } from './lib/viewports';
import { focusChat, nextThing, openLink, uiCommand } from './actions';
import { checkDnd, startStore } from './store/store';
import { now } from './lib/clock';
import { startLayer } from './lib/layer';
import { OverlayApp } from './components/OverlayApp';
import { BrainTestRoute, isBrainTestRoute } from './brain/testRoute';
import './styles/tokens.css';
import './styles/app.css';
import './styles/shell.css';

const root = createRoot(document.getElementById('root')!);
if (isBrainTestRoute()) {
  // #brain-test/<page>: a brain page alone (e2e of brain/testRoute.tsx)
  root.render(<StrictMode><BrainTestRoute /></StrictMode>);
} else if (location.hash === '#overlay') {
  // the global request layer page (main/overlay.ts): it only renders what the app page sends
  document.documentElement.classList.add('overlay');
  root.render(<StrictMode><OverlayApp /></StrictMode>);
} else if (isBrainTestRoute()) {
  root.render(<StrictMode><BrainTestRoute /></StrictMode>);
} else {
  // subscribe before the first render: events sent while React mounts (ui:command from tests/tools) are not lost
  startStore();
  startViewports();
  startLayer(focusChat, nextThing, link => { openLink(link); });
  setInterval(() => checkDnd(now()), 60_000);
  sb.on('ui:command', uiCommand);
  sb.on('focus:next', () => nextThing());
  root.render(<StrictMode><App /></StrictMode>);
}
