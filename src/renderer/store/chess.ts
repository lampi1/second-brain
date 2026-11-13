// The app's one chess game (ADR 0304): lib/chess-play.ts wired to the real bridge (main's engine and store), the UI
// clock, the current language and a real pause. A module of its own so the game survives leaving the Scacchi page.
// Used by components/chess/.
import { lang } from '../i18n';
import { now } from '../lib/clock';
import { createChessPlay } from '../lib/chess-play';
import { sb } from '../sb';

export const chess = createChessPlay({
  move: a => sb.invoke('chess:move', a),
  stop: () => sb.invoke('chess:stop', undefined),
  save: g => sb.invoke('chess:save', g),
  history: () => sb.invoke('chess:history', undefined),
  now,
  rnd: Math.random,
  lang,
  wait: ms => new Promise(done => setTimeout(done, ms)),
});
