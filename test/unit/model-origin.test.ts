// Checks event provenance presentation: real event model, legacy unknown, human attribution and reporter separation.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it } from 'vitest';
import { ModelOrigin } from '../../src/renderer/components/ModelOrigin';
import { FeedbackOrigins } from '../../src/renderer/brain/components/FeedbackOrigins';
import { normTables } from '../../src/renderer/brain/types';
import { setLang, t } from '../../src/renderer/i18n';

afterEach(() => setLang('it'));
const origin = { modelObserved: 'actual-event-model', engine: 'claude', sessionId: 'native-session', source: 'chat-provider-event', at: 50 };
const show = (props: Parameters<typeof ModelOrigin>[0]) => renderToStaticMarkup(createElement(ModelOrigin, props));

it('shows only complete observed event provenance, in both languages', () => {
  for (const language of ['it', 'en'] as const) {
    setLang(language);
    expect(show({ origin: JSON.stringify(origin) })).toContain('actual-event-model');
    expect(show({ origin: { modelObserved: 'configured-only' } })).not.toContain('configured-only');
    expect(show({})).toContain(t('origin.unavailable'));
  }
});

it('keeps humans distinct even when a reporter context carries an AI model', () => {
  expect(show({ human: true, origin })).not.toContain('actual-event-model');
  expect(show({ origin: { kind: 'human' } })).not.toContain('Modello:');
});

it('preserves separate reporter and responsible episode data through the tables normalizer', () => {
  const data = normTables({ errors: [{ reporterOrigin: JSON.stringify(origin) }], ideas: [{ origin: JSON.stringify(origin) }] });
  expect(data.errors[0]?.responsibleEpisode).toBeUndefined();
  expect(show({ origin: data.errors[0]?.responsibleEpisode })).not.toContain('actual-event-model');
  expect(show({ origin: data.ideas[0]?.origin })).toContain('actual-event-model');
});

it('renders real human feedback without assigning the reporter AI model or inventing empty records', () => {
  const data = normTables({ wins: [{ data: '2026-10-17', parole: 'Useful result', origin }] });
  setLang('en');
  const html = renderToStaticMarkup(createElement(FeedbackOrigins, { rows: data.wins }));
  expect(html).toContain('Useful result');
  expect(html).toContain('Human feedback');
  expect(html).not.toContain('actual-event-model');
  expect(renderToStaticMarkup(createElement(FeedbackOrigins, { rows: [] }))).toBe('');
});
