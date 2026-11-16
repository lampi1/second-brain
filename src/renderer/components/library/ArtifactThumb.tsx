// A card's picture in Memoria → Artifact (ADR 0318), asked only once the card is near the screen: an image scaled down
// by main; an HTML report drawn small from its head, cleaned exactly like the viewer cleans it (ReportHtml.tsx
// cleanReport: no script, no remote load, a shadow root of its own) and never interactive; a Markdown document as a
// small page of its title and first lines; a csv, json or txt as its first lines; a PDF as a paper with its badge; any
// other file (Word, Excel, video, an archive) as a tile with its extension. Used by ArtifactsTab.tsx.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Artifact, ArtifactThumb as Thumb } from '@shared/library';
import { cleanReport } from '../../brain/components/ReportHtml';
import { badgeOf, thumbOf } from '../../lib/library';
import { readsText } from '@shared/library';

/** The width the report is laid out at before it is scaled into the card. */
const PAGE_W = 1100;

function useNear(el: HTMLElement | null): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!el || near) return;
    if (typeof IntersectionObserver !== 'function') { setNear(true); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [el, near]);
  return near;
}

function MiniReport({ text, path }: { text: string; path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const { css, body } = cleanReport(text, path);
    const shadow = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    // the page's own look (a white sheet unless it sets one), its images waiting in grey (none is read for a card)
    style.textContent = `:host{display:block;background:#fff;color:#1d2330;color-scheme:light}.sb-report-root{padding:28px 34px;font:15px/1.55 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}img.sb-img-wait{min-width:160px;min-height:100px;background:#eceef2}.sb-img-note{display:none}\n${css}`;
    const page = document.createElement('div');
    page.className = 'sb-report-root';
    page.append(body);
    shadow.replaceChildren(style, page);
  }, [text, path]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.max(0.1, el.clientWidth / PAGE_W));
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  return <div className="lib-mini" ref={box} aria-hidden="true">
    <div ref={host} className="lib-mini-page" style={{ width: PAGE_W, transform: `scale(${scale})` }} inert />
  </div>;
}

export function ArtifactThumb({ a }: { a: Artifact }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const near = useNear(el);
  const [thumb, setThumb] = useState<Thumb | null | undefined>(undefined);
  const text = readsText(a.path) && a.kind !== 'html' && a.kind !== 'markdown';
  const wants = a.kind === 'image' || a.kind === 'html' || text;
  useEffect(() => {
    if (!near || !wants) return;
    let live = true;
    void thumbOf(a.id, a.at).then(t => { if (live) setThumb(t); });
    return () => { live = false; };
  }, [near, wants, a.id, a.at]);
  return <div ref={setEl} className="lib-thumb" data-kind={a.kind} data-ready={thumb ? 'true' : undefined}>
    {thumb?.kind === 'image' ? <img src={thumb.dataUrl} alt="" draggable={false} />
      : thumb?.kind === 'text' ? <pre className="lib-lines" aria-hidden="true">{thumb.text.replace(/^\uFEFF/, '').split(/\r?\n/, 14).map(l => l.slice(0, 140)).join('\n')}</pre>
      : thumb?.kind === 'html' ? <MiniReport text={thumb.text} path={thumb.path} />
        : a.kind === 'markdown' || (a.kind === 'html' && thumb === null) ? <div className="lib-paper" aria-hidden="true"><b>{a.title}</b>{a.summary && <span>{a.summary}</span>}<i /><i /><i /></div>
          : a.kind === 'pdf' ? <div className="lib-paper lib-paper-pdf" aria-hidden="true"><b>{a.title}</b><em>PDF</em><i /><i /><i /><i /></div>
            : thumb === null || !wants ? <div className="lib-tile" aria-hidden="true"><em>{badgeOf(a)}</em><span>{a.title}</span></div>
              : <div className="lib-thumb-wait" aria-hidden="true" />}
  </div>;
}
