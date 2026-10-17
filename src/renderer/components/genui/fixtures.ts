// Deterministic catalog/request fixtures used by render units and the standalone GenUI preview. No tools run.
import type { Lang, PendingRequest, UiCards, UiSpec } from '@shared/contract';

export const catalogFixtures: UiSpec[] = [
  { component: 'table', props: { columns: ['Verifica / Check', 'Dettaglio / Detail'], rows: [
    { cells: ['Contratto / Contract', 'Tipi validati / Validated types'], status: 'ok' },
    { cells: ['Pagamento / Payment', 'Arrotondamento / Rounding'], status: 'fail', link: { label: 'Issue', href: 'https://example.com/issues/27' } },
    { cells: ['Account', 'Accesso necessario / Sign in required'], status: 'blocked' },
    { cells: ['Build', 'In corso / Running'], status: 'running' },
    { cells: ['QA', 'Da verificare / Pending'], status: 'todo' },
    { cells: ['Quota', 'Stima / Estimate'], status: 'info' },
    { cells: ['Rilascio / Release', 'Verifica richiesta / Check required'], status: 'warn' },
  ] } },
  { component: 'cards', props: { options: [
    { title: 'Correzione mirata / Focused fix', summary: 'Una modifica piccola e verificabile / Small, reviewable change', pros: ['Compatibile / Compatible', '30 minuti / minutes'], cons: ['Copre un caso / Covers one case'], risk: 'low', effort: '30 min', recommended: true },
    { title: 'Riprogettazione / Redesign', pros: ['Copertura estesa / Broad coverage'], cons: ['Più revisione / More review'], risk: 'high', effort: '2 giorni / days' },
  ] } },
  { component: 'board', props: { lanes: [
    { title: 'In corso / Running', status: 'running', items: [{ title: 'Verifica accessibilità e tastiera / Check accessibility and keyboard', status: 'running', detail: 'Anteprima separata dalla risposta / Preview separate from answer' }] },
    { title: 'Bloccati / Blocked', status: 'blocked', items: [] },
    { title: 'Completati / Done', status: 'ok', items: [{ title: 'Contratto / Contract', links: [{ label: 'Report', href: 'C:/reports/qa.md' }] }] },
  ] } },
  { component: 'diffList', props: { groups: [{ area: 'Renderer', files: [
    { path: 'src/renderer/components/genui/ChoiceCard.tsx', added: 51, removed: 0, why: 'Opzioni ricche / Rich choices' },
    { path: 'C:/reports/accessibility-review.md', why: 'Evidenze / Evidence', added: 0, removed: 12 },
  ] }] } },
  { component: 'barChart', props: { unit: 'EUR', bars: [
    { label: 'Analisi e verifica / Analysis and verification', value: 12.45, note: 'Stima / Estimate' },
    { label: 'Rimborso / Refund', value: -4.2 }, { label: 'Nessun costo / No cost', value: 0 },
  ] } },
];

/** Each choice owns exactly one card. Recommendation and preview prose follow the selected fixture language. */
export function questionFixture(language: Lang = 'it'): PendingRequest {
  const italian = language === 'it';
  const question = italian ? 'Come procediamo?' : 'How shall we proceed?';
  const cards: UiCards['options'] = italian ? [
    { title: 'Correzione mirata', summary: 'Modifica piccola e verificabile', pros: ['Compatibile', '30 minuti'], cons: ['Copre un caso'], risk: 'low', effort: '30 min', recommended: true },
    { title: 'Riprogettazione', summary: 'Rivedi il flusso completo', pros: ['Copertura estesa'], cons: ['Più revisione'], risk: 'high', effort: '2 giorni' },
  ] : [
    { title: 'Focused fix', summary: 'Small and reviewable change', pros: ['Compatible', '30 minutes'], cons: ['Covers one case'], risk: 'low', effort: '30 min', recommended: true },
    { title: 'Redesign', summary: 'Revisit the entire flow', pros: ['Broad coverage'], cons: ['More review'], risk: 'high', effort: '2 days' },
  ];
  return {
    id: 'fixture-choice', chatId: 'fixture', type: 'question', tool: 'AskUserQuestion', title: question,
    detail: '', input: {}, at: 0, questions: [{ question, multiSelect: false, options: cards.map(card => ({
      label: card.title + (card.recommended ? (italian ? ' (Consigliata)' : ' (Recommended)') : ''),
      description: card.summary,
      preview: '```sb-ui\n' + JSON.stringify({ component: 'cards', props: { options: [card] }, title: italian ? 'Vantaggi e limiti' : 'Benefits and tradeoffs' }) + '\n```',
    })) }],
  };
}

export const richQuestion = questionFixture();
