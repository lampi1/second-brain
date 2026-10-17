// Server-rendered manifest panel coverage in both languages; model-authored strings stay escaped text.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it } from 'vitest';
import { AgentManifestPanel } from '../../src/renderer/components/AgentManifestPanel';
import { setLang } from '../../src/renderer/i18n';
afterEach(() => setLang('it'));
it('renders optional and declared values safely in Italian and English', () => {
  for (const language of ['it', 'en'] as const) {
    setLang(language);
    const html = renderToStaticMarkup(createElement(AgentManifestPanel, { manifest: { whenToUse: '<script>run()</script>', declaredTools: ['read', 'search'] } }));
    expect(html).toContain('&lt;script&gt;run()&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('read\nsearch');
    expect(html).toContain(language === 'it' ? 'Non specificato' : 'Not specified');
    expect(html).toContain(language === 'it' ? 'Non verificano' : 'does not verify');
  }
});
it('renders all seven editable fields with accessible labels and limits', () => {
  const html = renderToStaticMarkup(createElement(AgentManifestPanel, { manifest: { input: 'Question' }, onChange: () => {} }));
  expect(html.match(/<textarea/g)).toHaveLength(7);
  expect(html).toContain('maxLength="1200"');
  expect(html).toContain('maxLength="1600"');
  expect(html).toContain('Question</textarea>');
  expect(html).toContain('massimo 12 voci da 200 caratteri');
});
