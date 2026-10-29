// The "Contesto" block of a question or permission (the user, 2026-10-12: "quando mi fai le domande voglio sempre il
// contesto e il contenuto magari in un qualcosa di espandibile o il link dei report o pr"): the links the chat named
// (web pages and PRs open in the system browser, local files in the app's read-only file viewer, ADR 0183) always in
// sight as chips; under a toggle, the prose of the turn that ends with the request (its reasoning too, when that is where the model wrote it) and the options' previews, as sanitized markdown. Folded in
// a chat's own tile (the transcript is right above), open in the Orchestrator's card and in the questions window. Its keys
// stay its own: the panel ignores Enter on its links and toggle (RequestPanel.tsx). Visuals (ADR 0033): the ones the chat
// attached to this question (show_ui next-ask) always in sight on top, and an option's ```sb-ui preview fences drawn as
// catalog views (GenUi.tsx). A text to send in that prose (a mail, a comment: lib/sendable.ts) shows as the chat's own
// code block, with Copia and Mandato (ADR 0038); the other code blocks stay plain (the Orchestrator's card lists the turn's
// commands with Esegui apart). In the questions window (`layout="window"`, ADR 0049) it reads as a page and is never
// folded (the owner, 2026-10-22): the agent's context sentence above the question, then the whole context under it, a
// text to approve standing on its own as a document, the links as chips. Used by RequestPanel.tsx and CommandRequest.tsx.
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PendingRequest } from '@shared/contract';
import { askContext, withoutCommand, type ContextLink } from '../lib/askContext';
import { markdownParts, renderMarkdown } from '../lib/markdown';
import { isSendable } from '../lib/sendable';
import { CodeBlock } from './CodeBlock';
import { loadItems, useApp } from '../store/store';
import { IconChevronRight, IconFile, IconGlobe, IconInfo } from './Icons';
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

export const AskContext = memo(function AskContext({ req, defaultOpen, testBase, onToggle, layout = 'panel', question, lead, noVisuals, label }: {
  req: PendingRequest; defaultOpen: boolean; testBase: string; onToggle?: () => void; layout?: 'panel' | 'window';
  /** the decision card draws the attached visuals itself (ADR 0150) */
  noVisuals?: boolean;
  /** the toggle's name instead of «Contesto» */
  label?: string;
  /** the questions window: the question itself, drawn between the lead and the rest of the context */
  question?: ReactNode;
  /** the questions window: the context sentence the agent wrote in front of its question (lib/askSplit.ts) */
  lead?: string;
}) {
  if (layout === 'window') return <WindowContext req={req} testBase={testBase} question={question} lead={lead} />;
  return <PanelContext req={req} defaultOpen={defaultOpen} testBase={testBase} onToggle={onToggle} noVisuals={noVisuals} label={label} />;
});

/** The questions window's context, always open (the owner, 2026-10-22: «tutto il contesto nella modale deve essere
 *  sempre espanso»). With `question` (a question or permission) it reads top to bottom: the agent's own context
 *  sentence as a short lead (`lead`, lib/askSplit.ts), the question, then the whole context under a small label: images,
 *  "te la richiede", visuals, the turn's prose (its reasoning too), the links, the text to approve. The options'
 *  previews are open on their own cards. What is above
 *  the question is fixed at mount: what loads later goes under it, so the question never moves. Without `question` (a
 *  command card) only the context block. */
function WindowContext({ req, testBase, question, lead }: { req: PendingRequest; testBase: string; question?: ReactNode; lead?: string }) {
  const items = useApp(s => s.items[req.chatId]);
  useEffect(() => { if (items === undefined) void loadItems(req.chatId); }, [items, req.chatId]);
  const ctx = useMemo(() => {
    const all = askContext(items, req);
    // a command card already shows its block and the sentence before it: the context keeps only the rest
    return req.type === 'command' && req.command ? { ...all, pieces: withoutCommand(all.pieces, req.command.code, req.command.lead) } : all;
  }, [items, req]);
  const docs = useMemo(() => docsOf(ctx.pieces), [ctx.pieces]);
  const images = useAskImages(req, ctx.pieces);
  const links = useMemo(() => linksBut(ctx.links, images), [ctx.links, images]);
  // the options' previews are open on their own cards (ChoiceCard previewOpen), not repeated here
  const hasBody = ctx.pieces.length > 0;
  const visuals = (items ?? []).some(i => i.kind === 'artifact' && i.askId === req.id);
  const empty = !hasBody && !links.length && !ctx.again && !visuals && !images.length && !docs.length;
  const body = empty ? null : (
    <section className="wctx" data-testid={`${testBase}-ctx`} aria-label={t('chat.context.label')}>
      {hasBody && <div className="wq-label wctx-k">{t('chat.context.label')}</div>}
      <AskImages images={images} testBase={testBase} size="l" />
      {ctx.again && (
        <div className="ctx-again" role="note" data-testid={`${testBase}-ctx-again`}>
          {t('chat.context.again', { answer: ctx.again.answer })}
        </div>
      )}
      <AskArtifacts req={req} testBase={testBase} />
      {hasBody && (
        <div className="wctx-body" data-testid={`${testBase}-ctx-body`}>
          {ctx.pieces.map(p => (
            <div key={p.id} className={`ctx-piece ${p.kind}`}>
              {p.kind === 'thinking' && <div className="ctx-from">{t('chat.context.thinking')}</div>}
              {p.kind === 'thinking' ? <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(p.text) }} /> : <Prose chatId={req.chatId} itemId={p.id} text={p.text} docs={false} />}
            </div>
          ))}
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
    </section>
  );
  if (question === undefined) return body;
  return (
    <>
      {lead && <p className="wq-lead" data-testid={`${testBase}-ctx-lead`}>{lead}</p>}
      {question}
      {body}
    </>
  );
}

const PanelContext = memo(function PanelContext({ req, defaultOpen, testBase, onToggle, noVisuals, label }: { req: PendingRequest; defaultOpen: boolean; testBase: string; onToggle?: () => void; noVisuals?: boolean; label?: string }) {
  const items = useApp(s => s.items[req.chatId]);
  useEffect(() => { if (items === undefined) void loadItems(req.chatId); }, [items, req.chatId]);
  const ctx = useMemo(() => askContext(items, req), [items, req]);
  const previews = useMemo(() => (req.questions ?? []).flatMap(q => q.options.filter(o => o.preview?.trim()).map(o => ({ label: o.label, text: o.preview! }))), [req]);
  const [open, setOpen] = useState(defaultOpen);
  const hasBody = ctx.pieces.length > 0 || previews.length > 0;
  const visuals = !noVisuals && (items ?? []).some(i => i.kind === 'artifact' && i.askId === req.id);
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
      {!noVisuals && <AskArtifacts req={req} testBase={testBase} />}
      <AskImages images={images} testBase={testBase} />
      {hasBody && (
        <button type="button" className="ctx-toggle" onClick={() => { setOpen(o => !o); onToggle?.(); }} aria-expanded={open} data-testid={`${testBase}-ctx-toggle`}>
          <IconInfo size={12} /><b>{label ?? t('chat.context.label')}</b>
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
