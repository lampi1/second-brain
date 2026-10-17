// Shared renderer behavior and IT/EN key parity; no browser, account or real provider. Included by the normal unit glob.
import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExtensionSection } from '../../src/renderer/extensions/ExtensionSection';
import { sectionsIt } from '../../src/renderer/i18n/areas/sections.it';
import { sectionsEn } from '../../src/renderer/i18n/areas/sections.en';
import { setLang } from '../../src/renderer/i18n';
import fixture from '../fixtures/extensions/pratiche.json';
it('keeps parity and renders localized status/error/empty text while escaping user cells', () => {
  expect(Object.keys(sectionsEn).sort()).toEqual(Object.keys(sectionsIt).sort());
  try {
    setLang('en');
    const html = renderToStaticMarkup(createElement(ExtensionSection, { manifest: fixture }));
    expect(html).toContain('Completed'); expect(html).not.toContain('Completata');
    expect(renderToStaticMarkup(createElement(ExtensionSection, { manifest: {} }))).toContain(sectionsEn['sections.invalid']);
    expect(renderToStaticMarkup(createElement(ExtensionSection, { manifest: { ...fixture, rows: [] } }))).toContain(sectionsEn['sections.noRows']);
  } finally { setLang('it'); }
});
