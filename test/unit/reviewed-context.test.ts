// Human preview keeps the exact bounded agent packet and ordinary editable message, with no HTML or hidden extra fields.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { reviewedContextDraft, REVIEWED_CONTEXT_MARKER, withReviewedContext } from '../../src/renderer/lib/reviewed-context';
import { ReviewedContextPreview } from '../../src/renderer/components/ReviewedContextPreview';
import { setLang } from '../../src/renderer/i18n';
const fact = { key: 'work', value: '<script>not executable</script>', sourceId: 'essential', sourceLabel: 'User-confirmed information' };
const json = JSON.stringify({ kind: 'untrusted-user-context', schemaVersion: 1, facts: [fact] }, null, 2);
const payload = `${REVIEWED_CONTEXT_MARKER}\n${json}`;

it('separates readable input while preserving exact payload bytes for send, edit, reload and queue', () => {
  const original = 'My existing request\n\n'+payload, context = reviewedContextDraft(original)!;
  expect(context.message).toBe('My existing request');
  expect(context.payload).toBe(payload);
  expect(withReviewedContext(context.message, context)).toBe(original);
  const edited = withReviewedContext('Please compare these facts', context);
  expect(reviewedContextDraft(edited)!.payload).toBe(payload);
  expect(reviewedContextDraft(edited)!.message).toBe('Please compare these facts');
  expect(withReviewedContext('', context)).toBe(payload);
  expect(withReviewedContext(context.message, null)).toBe('My existing request');
});

it('keeps malformed, oversized and unknown-field packets visible as ordinary text', () => {
  for (const text of ['ordinary message', payload+' trailing text', `${REVIEWED_CONTEXT_MARKER}\n{}`, payload+' '.repeat(9000), `${REVIEWED_CONTEXT_MARKER}\n${JSON.stringify({ kind:'untrusted-user-context', schemaVersion:1, facts:[fact], hiddenInstructions:'not visible' })}`, `${REVIEWED_CONTEXT_MARKER}\n${JSON.stringify({ kind:'untrusted-user-context', schemaVersion:1, facts:[{...fact, hidden:'not visible'}] })}`]) expect(reviewedContextDraft(text)).toBeNull();
});

it('renders prototype-like fact keys as literal data without inherited property lookup', () => {
  for (const key of ['__proto__', 'constructor', 'toString']) {
    const text = `${REVIEWED_CONTEXT_MARKER}\n${JSON.stringify({kind:'untrusted-user-context',schemaVersion:1,facts:[{...fact,key}]})}`;
    const html = renderToStaticMarkup(createElement(ReviewedContextPreview, {context:reviewedContextDraft(text)!,onRemove:()=>{}}));
    expect(html).toContain(`<dt>${key}</dt>`);
  }
});

it('renders escaped readable data and on-demand payload inspection in Italian and English', () => {
  try {
    for (const language of ['it','en'] as const) {
      setLang(language);
      const html = renderToStaticMarkup(createElement(ReviewedContextPreview, { context:reviewedContextDraft(payload)!, onRemove:()=>{} }));
      expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');
      expect(html).toContain(language==='it'?'Dati allegati alla bozza':'Context attached to this draft');
      expect(html).toContain(language==='it'?'Il tuo lavoro':'Your work');
      expect(html).toContain('<details>');expect(html).not.toContain('<details open');
    }
  } finally { setLang('it'); }
});
