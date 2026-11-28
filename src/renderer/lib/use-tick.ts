// A clock that ticks every `ms` from the first render (useState + setInterval), safe in a server render (the unit tests'
// renderToStaticMarkup), unlike lib/clock.ts's shared useNow, which has no server snapshot. Used by WaitingRow.tsx and
// CredentialCard.tsx (minutes of a finished wait, the credentials card's 10 minutes).
import { useEffect, useState } from 'react';

export function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(h); }, [ms]);
  return now;
}
