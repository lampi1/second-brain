// «Andamento» (G C, ADR 0202; report «Cosa tenere», «Da accorpare»): the four statistics pages in one, as tabs, plus the
// app's own use. A sticky head keeps the title and the tab bar on screen while a tab scrolls; each tab starts with the
// same toolbar (what it shows on the left, period / refresh / guide on the right, brain/components/States.tsx PageHead
// without a title) and shows each number once. Tabs: Costi (brain/pages/Costi.tsx), Qualità (brain/pages/Qualita.tsx,
// with the Classificatori section since ADR 0210, once a tab here and before that a Brain page), Apprendimento
// (brain-model/LearningPage.tsx, once a Memoria tab) and Uso (UsageTab.tsx, the local usage counter). The page arg "andamento/<tab>[/<more>]" picks the
// tab (lib/andamento.ts); the old ids, links and G-keys land here (actions.ts go()). Data and IPC are each tab's own,
// unchanged. Rendered by App.tsx PageFrame for 'andamento'; styles: styles/andamento.css.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { brainBridge, go, goTarget } from '../../actions';
import { t } from '../../i18n';
import { pageLabel, ui } from '../../store/ui';
import { TREND_TABS, parseTrendArg, trendArg, type TrendTab } from '../../lib/andamento';
import { DiscussContext } from '../../brain/components/Discuss';
import { Toaster } from '../../brain/components/ui';
import { Costi } from '../../brain/pages/Costi';
import { Qualita } from '../../brain/pages/Qualita';
import { LearningPage } from '../brain-model/LearningPage';
import { IconChart, IconCoins, IconGrid, IconTarget } from '../Icons';
import { UsageTab } from './UsageTab';
import '../../styles/andamento.css';

const ICON: Record<TrendTab, ReactNode> = {
  costi: <IconCoins />, qualita: <IconChart />, apprendimento: <IconTarget />, uso: <IconGrid />,
};

/** The tab bar: pills with a sliding ink under the chosen one; ←/→, Home and End move between tabs (WAI-ARIA tabs). */
function TrendTabs({ tab, onTab }: { tab: TrendTab; onTab: (tab: TrendTab) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const [ink, setInk] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = bar.current?.querySelector<HTMLElement>('[aria-selected=true]');
      if (el) setInk({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    };
    place();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    if (bar.current) { ro?.observe(bar.current); bar.current.querySelectorAll('button').forEach(b => ro?.observe(b)); }
    return () => ro?.disconnect();
  }, [tab]);
  const key = (e: KeyboardEvent, i: number) => {
    const n = TREND_TABS.length;
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    onTab(TREND_TABS[next]!);
    requestAnimationFrame(() => document.getElementById(`an-tab-${TREND_TABS[next]}`)?.focus());
  };
  return <div className="an-tabs" role="tablist" aria-label={t('trend.tabsLabel')} ref={bar} data-testid="an-tabs">
    {ink && <i className="an-ink" aria-hidden="true" style={{ transform: `translate(${ink.x}px, ${ink.y}px)`, width: ink.w, height: ink.h }} />}
    {TREND_TABS.map((id, i) => {
      const on = id === tab;
      return <button key={id} type="button" role="tab" id={`an-tab-${id}`} aria-controls="an-panel" aria-selected={on} tabIndex={on ? 0 : -1}
        data-testid={`an-tab-${id}`} onClick={() => onTab(id)} onKeyDown={e => key(e, i)}>
        <span className="an-tab-icon" aria-hidden="true">{ICON[id]}</span>{t(`trend.tab.${id}`)}
      </button>;
    })}
  </div>;
}

function TabContent({ tab, rest }: { tab: TrendTab; rest: string | null }) {
  switch (tab) {
    case 'costi': return <Costi arg={rest ?? undefined} nav={goTarget} embedded />;
    case 'qualita': return <Qualita nav={goTarget} embedded />;
    case 'apprendimento': return <LearningPage />;
    case 'uso': return <UsageTab />;
  }
}

export function AndamentoPage() {
  const arg = ui.use(s => s.pageArg);
  const { tab, rest } = useMemo(() => parseTrendArg(arg), [arg]);
  // a tab change is a place of its own (back / forward, links, the usage counter); within a tab its arg stays
  const onTab = (next: TrendTab) => { if (next !== tab) go({ page: 'andamento', arg: trendArg(next) }); };
  // a new tab starts from its top, the sticky head still on screen
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [tab]);
  return <div ref={scroller} className="bx bx-page bx-scroll an-scroll" role="region" aria-label={pageLabel('andamento')}>
    <DiscussContext.Provider value={brainBridge}>
      <div className="bx-inner an-inner">
        <div className="an-page" data-testid="andamento-page" data-tab={tab}>
          <div className="an-top">
            <header className="an-head">
              <h1>{pageLabel('andamento')}</h1>
              <p className="an-lead">{t('trend.lead')}</p>
            </header>
            <TrendTabs tab={tab} onTab={onTab} />
          </div>
          <section className="an-panel" role="tabpanel" id="an-panel" aria-labelledby={`an-tab-${tab}`} key={tab} data-testid={`an-panel-${tab}`}>
            <TabContent tab={tab} rest={rest} />
          </section>
        </div>
      </div>
    </DiscussContext.Provider>
    <Toaster />
  </div>;
}
