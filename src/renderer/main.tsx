// Renderer entry. The app page: starts the data store, the browser-view reporter, the global-layer sync, the focus
// keeper (lib/focusKeeper.ts) and the main→UI command listeners, then mounts App.tsx. The same bundle with #overlay is the global request layer page
// (main/overlay.ts): it mounts OverlayApp.tsx only; with #brain-test/<page> it shows a brain page alone (the test
// route of brain/testRoute.tsx).
import { t as auditText } from './i18n';
import {startUpdateCheckpoint} from './lib/update-checkpoint';
import {toast} from './store/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { sb } from './sb';
import { startViewports } from './lib/viewports';
import { startBeat } from './lib/beat';
import { startInputLag } from './lib/inputlag';
import { focusChat, nextThing, openLink, uiCommand } from './actions';
import { checkDnd, startStore } from './store/store';
import { now } from './lib/clock';
import { startLayer } from './lib/layer';
import { startFocusKeeper } from './lib/focusKeeper';
import { startTypingWatch } from './lib/questions';
import { OverlayApp } from './components/OverlayApp';
import { BrainTestRoute, isBrainTestRoute } from './brain/testRoute';
import { startLater } from './lib/later';
import { LangRoot, startLang } from './i18n/LangRoot';
import './styles/tokens.css';
import './styles/app.css';
import './styles/shell.css';
import './styles/code.css';
import './styles/genui.css';
import './styles/qwin.css';
import './styles/linear.css';

const root = createRoot(document.getElementById('root')!);
startBeat(); // every page: the alive marks (dots, spinners, pulses) step 5 times a second instead of animating
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
  // subscribe at once, before any await: a ui:command sent while the update recovery is read or React mounts (the
  // demo's frozen clock at did-finish-load, tests, tools) waits here and runs, in order, once the store has started
  const early: Parameters<typeof uiCommand>[0][] = [];
  let started = false;
  sb.on('ui:command', cmd => { if (started) uiCommand(cmd); else early.push(cmd); });
  root.render(<div role="status">{auditText('cmp.main.restoring')}</div>);
  void startUpdateCheckpoint().catch(()=>toast(auditText('cmp.main.restoreUnavailable'),'err')).then(()=>{
  startStore();
  startViewports();
  startLater(); // "Rispondi dopo": main's flag, before the first popup can show
  startLayer(focusChat, nextThing, link => { openLink(link); });
  startInputLag(); // key → letter on screen, one summary a minute to the `perf` log while the user types
  startFocusKeeper();
  startTypingWatch();
  setInterval(() => checkDnd(now()), 60_000);
  started = true;
  for (const cmd of early.splice(0)) uiCommand(cmd);
  sb.on('focus:next', () => nextThing());
  // the language first (ADR 0057): the first render is already in the right one
  void startLang().then(() => root.render(<StrictMode><LangRoot><App /></LangRoot></StrictMode>));
  });
}
