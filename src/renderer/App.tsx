import { useEffect, useState } from 'react';
import type { AppInfo } from '@shared/contract';
import { sb } from './sb';

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => { void sb.invoke('app:info', undefined).then(setInfo); }, []);
  return (
    <div className="app" data-testid="app">
      <header className="topbar"><span className="brand"><i>◆</i> second-brain</span><span className="dim">{info ? `v${info.version}` : '…'}</span></header>
    </div>
  );
}
