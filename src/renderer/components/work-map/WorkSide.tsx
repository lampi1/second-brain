// The side panel of a work map (ADR 0343): with no box picked the job itself (the request, when it is finished, the answers
// already clear, the images and the links its texts name, its versions); with a box picked that step in full (what it
// covers, who does it, when it starts, how far it is, its chats). Used by WorkMapView.tsx.
import { ROLE_DEFAULTS } from '@shared/roles';
import type { WorkBox, WorkMapView as View } from '@shared/work-map';
import { t } from '../../i18n';
import { linksIn } from '../../lib/askContext';
import { imagesIn, withoutImages } from '../../lib/askImages';
import { ago } from '../../lib/format';
import { AskImages } from '../AskImages';
import { openFile } from '../GenUi';
import { IconArrowLeft, IconFile, IconGlobe } from '../Icons';
import { stateOf, whenOf, whoOf } from '../project-map/plan-words';
import { chatsOf } from '../../lib/work-maps';
import { LiveChip, Stale } from './LiveBits';
import { BoxChats } from './WorkDrawing';

function Evidence({ texts, chatId }: { texts: readonly string[]; chatId: string | undefined }) {
  const images = imagesIn(texts.map(text => ({ text }))), links = linksIn(texts);
  return <>
    {images.length > 0 && <AskImages images={images} testBase="wm-side" />}
    {links.length > 0 && <><h4>{t('wm.side.links')}</h4><div className="ctx-links" data-testid="wm-side-links">
      {links.map((l, i) => l.kind === 'web'
        ? <a key={l.href} className="ctx-link" href={l.href} target="_blank" rel="noopener noreferrer" title={l.href} data-testid={`wm-side-link-${i}`}><IconGlobe size={12} /><span>{l.label}</span></a>
        : <button key={l.href} type="button" className="ctx-link file" onClick={() => void openFile(l.href, chatId)} title={l.href} data-testid={`wm-side-link-${i}`}><IconFile size={12} /><span>{l.label}</span></button>)}
    </div></>}
  </>;
}

/** Who made a version: the user and the app are written in words, a chat with its title. */
const byOf = (by: string) => (by === 'user' ? t('wm.by.user') : by === 'app' ? t('wm.by.app') : by);

function Job({ view, now }: { view: View; now: number }) {
  const { map: m, history } = view, plan = m.plan;
  const texts = [m.idea ?? '', ...(plan ? [...plan.steps.flatMap(s => [s.title, s.detail ?? '']), plan.doneWhen ?? '', ...plan.clarified.flatMap(c => [c.q, c.a])] : [])];
  return <>
    <span className="dash-eyebrow">{t('wm.side.job')}</span>
    {m.idea && m.idea.trim() !== m.title.trim() && <><h4>{t('wm.side.idea')}</h4><p className="wm-pre" data-testid="wm-side-idea">{withoutImages(m.idea)}</p></>}
    {plan?.doneWhen && <><h4>{t('wm.side.doneWhen')}</h4><p data-testid="wm-side-done">{withoutImages(plan.doneWhen)}</p></>}
    {!!plan?.clarified.length && <><h4>{t('wm.side.known')}</h4><ul className="wm-known" data-testid="wm-side-known">{plan.clarified.map((c, i) => <li key={i}><span>{c.q}</span><b>{c.a}</b></li>)}</ul></>}
    <Evidence texts={texts} chatId={m.owner?.chatId} />
    {view.boxes.length > 1 && <p className="wm-muted">{t('wm.side.pick')}</p>}
    {history.length > 0 && <><h4>{t('wm.side.history')}</h4><ol className="wm-history" data-testid="wm-side-history">{[...history].sort((a, b) => b.version - a.version).slice(0, 12).map(h => <li key={h.version}><span>{h.summary}</span><small>{byOf(h.by)} · {ago(h.at, now)}</small></li>)}</ol></>}
  </>;
}

function Step({ b, view, now, onBack }: { b: WorkBox; view: View; now: number; onBack: () => void }) {
  const who = whoOf(b), name = b.role ? ROLE_DEFAULTS[b.role].name : t('wm.self');
  return <>
    <button type="button" className="wm-side-back" onClick={onBack} data-testid="wm-side-back"><IconArrowLeft size={12} />{t('wm.side.back')}</button>
    <span className="dash-eyebrow">{t('wm.side.step', { n: b.n })}</span>
    <h3 data-testid="wm-side-title">{withoutImages(b.title)}</h3>
    {b.detail && <p className="wm-pre">{withoutImages(b.detail)}</p>}
    <p>{stateOf(b, now)}{b.outcome && b.outcome !== 'done' ? ` · ${t(`wm.outcome.${b.outcome}`)}` : ''} <LiveChip live={b.live} testid="wm-side-live" /> <Stale live={b.live} now={now} testid="wm-side-stale" /></p>
    <h4>{t('wm.side.who')}</h4><p title={who && b.preset ? t('pm.step.presetTip') : undefined}>{who ?? name}</p>
    <h4>{t('wm.side.when')}</h4><p>{whenOf(b, view.boxes.filter(x => !x.drop))}</p>
    {chatsOf(b).length > 0 && <><h4>{t('wm.side.chats')}</h4><div className="wm-box-chats"><BoxChats b={b} testid="wm-side-chat" /></div></>}
    <Evidence texts={[b.title, b.detail ?? '']} chatId={view.map.owner?.chatId} />
  </>;
}

export function WorkSide({ view, picked, now, onPick }: { view: View; picked: number | null; now: number; onPick: (n: number | null) => void }) {
  const b = picked === null ? undefined : view.boxes.find(x => x.n === picked);
  return <aside className="wm-side" data-testid="wm-side" aria-label={t('wm.side.label')}>
    {b ? <Step b={b} view={view} now={now} onBack={() => onPick(null)} /> : <Job view={view} now={now} />}
  </aside>;
}
