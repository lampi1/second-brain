// The "Contesto" block of a question or permission (the user, 2026-10-12: "quando mi fai le domande voglio sempre il
// contesto e il contenuto magari in un qualcosa di espandibile o il link dei report o pr"): the links the chat named
// (web pages and PRs open in the system browser, local files through app:openPath: documents open, anything else is
// only shown in Explorer) always in sight as chips; under a toggle, the prose of the turn that ends with the request
// (its reasoning too, when that is where the model wrote it) and the options' previews, as sanitized markdown. Folded in
// a chat's own tile (the transcript is right above), open in the Regia's card and in the questions window. Its keys
// stay its own: the panel ignores Enter on its links and toggle (RequestPanel.tsx). Visuals (ADR 0033): the ones the chat
// attached to this question (show_ui next-ask) always in sight on top, and an option's ```sb-ui preview fences drawn as
// catalog views (GenUi.tsx). A text to send in that prose (a mail, a comment: lib/sendable.ts) shows as the chat's own
// code block, with Copia and Mandato (ADR 0038); the other code blocks stay plain (the Regia's card lists the turn's
// commands with Esegui apart). In the questions window (`layout="window"`, ADR 0049) it reads as a page: a text to approve
// stands on its own as a document (never folded, never inside a scrolling box), the lead above the question is the
// agent's context sentence or two lines of "why" that unfold with a click, the links stay chips. Used by RequestPanel.tsx and CommandRequest.tsx.
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PendingRequest } from '@shared/contract';
import { askContext, type ContextLink } from '../lib/askContext';
import { markdownParts, renderMarkdown } from '../lib/markdown';
import { isSendable } from '../lib/sendable';
import { CodeBlock } from './CodeBlock';
import { loadItems, useApp } from '../store/store';
import { IconChevronDown, IconChevronRight, IconFile, IconGlobe, IconInfo } from './Icons';
import { AskArtifacts, UiPreview, openFile } from './GenUi';
import { AskImages } from './AskImages';
import { imagesIn, withoutImages, type AskImage } from '../lib/askImages';
import { cleanLabel } from '../lib/keys';
import { t } from '../i18n';

/** The images the request names: its questions and options first (captioned with the option), then the turn's prose. */
function useAskImages(req: PendingRequest, pieces: readonly { kind: string; text: string }[]): AskImage[] {
  return useMemo(() => imagesIn([
    ...(req.questions ?? []).flatMap(q => [{ text: q.question }, ...q.options.map(o => ({ text: [o.label, o.description ?? '', o.preview ?? ''].join('\n'), caption: cleanLabel(o.label) }))]),
    ...pieces.filter(p => p.kind === 'text').map(p => ({ text: p.text })),
  ]), [req, pieces]);
}

const fileKey = (href: string) => { let x = href.replace(/^file:\/+/i, ''); try { x = decodeURIComponent(x); } catch { /* as is */ } return x.replace(/\//g, '\\').toLowerCase(); };
/** The link chips without the files already shown as thumbnails. */
const linksBut = (links: readonly ContextLink[], images: readonly AskImage[]): readonly ContextLink[] => {
  if (!images.length) return links;
  const shown = new Set(images.map(i => i.path.toLowerCase()));
  return links.filter(l => l.kind !== 'file' || !shown.has(fileKey(l.href)));
};

const FENCE = /^\s{0,3}(`{3,}|~{3,})/m;

/** A piece of the turn's prose: markdown, and its texts to send as code blocks with Copia / Mandato (`docs` = false:
 *  left out, the questions window shows them on their own). */
function Prose({ chatId, itemId, text, docs = true }: { chatId: string; itemId: string; text: string; docs?: boolean }) {
  const parts = useMemo(() => (FENCE.test(text) ? markdownParts(text) : null), [text]);
  if (!parts?.some(p => p.kind === 'code' && isSendable(p.lang))) return <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
  return (
    <div className="msg-md">
      {parts.map((p, i) => (p.kind === 'html'
        ? (p.html.trim() ? <div key={i} className="md" dangerouslySetInnerHTML={{ __html: p.html }} /> : null)
        : isSendable(p.lang) ? (docs ? <CodeBlock key={i} chatId={chatId} itemId={itemId} lang={p.lang} code={p.code} /> : null)
          : <div key={i} className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(`~~~~${p.lang}\n${p.code}\n~~~~`) }} />))}
    </div>
  );
}

const oneLine = (md: string) => withoutImages(md).replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`|[\]]/g, '').replace(/\(\s*(?:https?|file):[^)]*\)/g, '').replace(/\s+/g, ' ').trim();

function LinkChip({ l, testid, chatId }: { l: ContextLink; testid: string; chatId: string }) {
  const tip = l.kind === 'file' ? l.href.replace(/^file:\/+/i, '') : l.href;
  if (l.kind === 'web') {
    return <a className="ctx-link" href={l.href} target="_blank" rel="noopener noreferrer" data-tip={tip} data-testid={testid}><IconGlobe size={12} /><span>{l.label}</span></a>;
  }
  return (
    <button type="button" className="ctx-link file" onClick={() => void openFile(l.href,chatId)} data-tip={tip} data-testid={testid}>
      <IconFile size={12} /><span>{l.label}</span>
    </button>
  );
}

/** The texts to send in the turn's prose, each with the message it came from. */
function docsOf(pieces: readonly { id: string; kind: string; text: string }[]): { itemId: string; lang: string; code: string }[] {
  return pieces.flatMap(p => (p.kind === 'text' && FENCE.test(p.text)
    ? markdownParts(p.text).flatMap(x => (x.kind === 'code' && isSendable(x.lang) && x.code.trim() ? [{ itemId: p.id, lang: x.lang, code: x.code }] : []))
    : []));
}

export const AskContext = memo(function AskContext({ req, defaultOpen, testBase, onToggle, layout = 'panel', question, lead }: {
  req: PendingRequest; defaultOpen: boolean; testBase: string; onToggle?: () => void; layout?: 'panel' | 'window';
  /** the questions window: the question itself, drawn between the lead and the rest of the context */
  question?: ReactNode;
  /** the questions window: the context sentence the agent wrote in front of its question (lib/askSplit.ts) */
  lead?: string;
}) {
  if (layout === 'window') return <WindowContext req={req} testBase={testBase} onToggle={onToggle} question={question} lead={lead} />;
  return <PanelContext req={req} defaultOpen={defaultOpen} testBase={testBase} onToggle={onToggle} />;
});

/** The questions window's context. With `question` (a question or permission) it reads top to bottom: a short muted
 *  lead, the question, then the rest (the full context one click away, images, links, the text to approve). The lead is
 *  the agent's own context sentence (`lead`, lib/askSplit.ts), else the two lines of the turn's why as they were when the
 *  card opened (only if the chat's items were already there). What is above the question is fixed at mount and never
 *  grows: what loads or unfolds later (the full context, "te la richiede", images) goes under it, so the question never
 *  moves. Without `question` (a command card) the old order: two lines of why, the links, the documents. */
function WindowContext({ req, testBase, onToggle, question, lead }: { req: PendingRequest; testBase: string; onToggle?: () => void; question?: ReactNode; lead?: string }) {
  const items = useApp(s => s.items[req.chatId]);
  useEffect(() => { if (items === undefined) void loadItems(req.chatId); }, [items, req.chatId]);
  const ctx = useMemo(() => askContext(items, req), [items, req]);
  // the lead above the question: the agent's own sentence follows the current step (it changes only with the question);
  // the turn's "why" is frozen as the card opens, so late-loaded items never push the question down
  const [why] = useState(() => {
    const last = items === undefined ? undefined : ctx.pieces[ctx.pieces.length - 1];
    return last ? oneLine(last.text) : '';
  });
  const top = question === undefined ? '' : lead || why;
  const docs = useMemo(() => docsOf(ctx.pieces), [ctx.pieces]);
  const images = useAskImages(req, ctx.pieces);
  const links = useMemo(() => linksBut(ctx.links, images), [ctx.links, images]);
  const previews = useMemo(() => (req.questions ?? []).flatMap(q => q.options.filter(o => o.preview?.trim()).map(o => ({ label: o.label, text: o.preview! }))), [req]);
  const [open, setOpen] = useState(false);
  const last = ctx.pieces[ctx.pieces.length - 1];
  const summary = last ? oneLine(last.text) : '';
  const hasBody = ctx.pieces.length > 0 || previews.length > 0;
  const visuals = (items ?? []).some(i => i.kind === 'artifact' && i.askId === req.id);
  const toggle = (to: boolean) => { setOpen(to); onToggle?.(); };
  const rest = (
    <>
      <AskImages images={images} testBase={testBase} size="l" />
      {ctx.again && (
        <div className="ctx-again" role="note" data-testid={`${testBase}-ctx-again`}>
          {t('chat.context.again', { answer: ctx.again.answer })}
        </div>
      )}
      <AskArtifacts req={req} testBase={testBase} />
      {hasBody && !open && (top ? (
        // the lead is already on top: only the way to the whole context here
        <button type="button" className="wctx-more wq-ctx-more" onClick={() => toggle(true)} aria-expanded={false} data-testid={`${testBase}-ctx-toggle`}>{t('chat.context.more')} <IconChevronDown size={12} /></button>
      ) : (
        <button type="button" className="wctx-why" onClick={() => toggle(true)} aria-expanded={false} data-testid={`${testBase}-ctx-toggle`}>
          <span className="wctx-text">{summary || t('chat.context.summaryPreview', { label: previews[0]?.label ?? '' })}</span>
          <span className="wctx-more">{t('chat.context.more')} <IconChevronDown size={12} /></span>
        </button>
      ))}
      {hasBody && open && (
        <div className="wctx-body" data-testid={`${testBase}-ctx-body`}>
          {ctx.pieces.map(p => (
            <div key={p.id} className={`ctx-piece ${p.kind}`}>
              {p.kind === 'thinking' && <div className="ctx-from">{t('chat.context.thinking')}</div>}
              {p.kind === 'thinking' ? <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(p.text) }} /> : <Prose chatId={req.chatId} itemId={p.id} text={p.text} docs={false} />}
            </div>
          ))}
          {previews.map((p, i) => (
            <div key={i} className="ctx-piece preview">
              <div className="ctx-from">{t('chat.context.preview', { label: p.label })}</div>
              <UiPreview text={p.text} chatId={req.chatId}/>
            </div>
          ))}
          <button type="button" className="wctx-less" onClick={() => toggle(false)} aria-expanded data-testid={`${testBase}-ctx-toggle`}>{t('chat.context.less')} <IconChevronDown size={12} className="up" /></button>
        </div>
      )}
      {links.length > 0 && (
        <div className="ctx-links" data-testid={`${testBase}-ctx-links`}>
          {links.map((l, i) => <LinkChip key={`${l.kind}:${l.href}`} l={l} chatId={req.chatId} testid={`${testBase}-ctx-link-${i}`} />)}
        </div>
      )}
      {docs.map((d, i) => (
        <section key={`${d.itemId}.${i}`} className="wdoc" data-testid={`${testBase}-doc`} aria-label={t('chat.context.document')}>
          <CodeBlock chatId={req.chatId} itemId={d.itemId} lang={d.lang} code={d.code} label={t('chat.context.document')} />
        </section>
      ))}
    </>
  );
  const empty = !hasBody && !links.length && !ctx.again && !visuals && !images.length;
  const body = empty ? null : <div className={`wctx ${open ? 'open' : ''}`} data-testid={`${testBase}-ctx`}>{rest}</div>;
  if (question === undefined) return body;
  return (
    <>
      {top && <p className={`wq-lead ${lead ? 'own' : 'why'}`} data-testid={`${testBase}-ctx-lead`}>{top}</p>}
      {question}
      {body}
    </>
  );
}

const PanelContext = memo(function PanelContext({ req, defaultOpen, testBase, onToggle }: { req: PendingRequest; defaultOpen: boolean; testBase: string; onToggle?: () => void }) {
  const items = useApp(s => s.items[req.chatId]);
  useEffect(() => { if (items === undefined) void loadItems(req.chatId); }, [items, req.chatId]);
  const ctx = useMemo(() => askContext(items, req), [items, req]);
  const previews = useMemo(() => (req.questions ?? []).flatMap(q => q.options.filter(o => o.preview?.trim()).map(o => ({ label: o.label, text: o.preview! }))), [req]);
  const [open, setOpen] = useState(defaultOpen);
  const hasBody = ctx.pieces.length > 0 || previews.length > 0;
  const visuals = (items ?? []).some(i => i.kind === 'artifact' && i.askId === req.id);
  const images = useAskImages(req, ctx.pieces);
  const links = useMemo(() => linksBut(ctx.links, images), [ctx.links, images]);
  if (!hasBody && !links.length && !ctx.again && !visuals && !images.length) return null;
  const last = ctx.pieces[ctx.pieces.length - 1];
  const summary = last ? oneLine(last.text) : previews.length ? t('chat.context.summaryPreview', { label: previews[0]!.label }) : '';
  return (
    <div className={`ask-ctx ${open ? 'open' : ''}`} data-testid={`${testBase}-ctx`}>
      {ctx.again && (
        <div className="ctx-again" role="note" data-testid={`${testBase}-ctx-again`}>
          {t('chat.context.again', { answer: ctx.again.answer })}
        </div>
      )}
      <AskArtifacts req={req} testBase={testBase} />
      <AskImages images={images} testBase={testBase} />
      {hasBody && (
        <button type="button" className="ctx-toggle" onClick={() => { setOpen(o => !o); onToggle?.(); }} aria-expanded={open} data-testid={`${testBase}-ctx-toggle`}>
          <IconInfo size={12} /><b>{t('chat.context.label')}</b>
          {!open && summary && <span className="ctx-summary">{summary}</span>}
          <IconChevronRight size={12} className="tool-chev" />
        </button>
      )}
      {open && hasBody && (
        <div className="ctx-body" data-testid={`${testBase}-ctx-body`}>
          {ctx.pieces.map(p => (
            <div key={p.id} className={`ctx-piece ${p.kind}`}>
              {p.kind === 'thinking' && <div className="ctx-from">{t('chat.context.thinking')}</div>}
              {p.kind === 'thinking' ? <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(p.text) }} /> : <Prose chatId={req.chatId} itemId={p.id} text={p.text} />}
            </div>
          ))}
          {previews.map((p, i) => (
            <div key={i} className="ctx-piece preview">
              <div className="ctx-from">{t('chat.context.preview', { label: p.label })}</div>
              <UiPreview text={p.text} chatId={req.chatId}/>
            </div>
          ))}
        </div>
      )}
      {links.length > 0 && (
        <div className="ctx-links" data-testid={`${testBase}-ctx-links`}>
          {links.map((l, i) => <LinkChip key={`${l.kind}:${l.href}`} l={l} chatId={req.chatId} testid={`${testBase}-ctx-link-${i}`} />)}
        </div>
      )}
    </div>
  );
});
