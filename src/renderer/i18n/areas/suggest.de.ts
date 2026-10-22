// German (de-AT, informal "du") texts of the chat composer's inline suggestion (issue #167, ADR 0118); same keys as
// suggest.it.ts. Spread into i18n/de.ts.
import type { suggestIt } from './suggest.it';
export const suggestDe: typeof suggestIt = {
  'suggest.srHint': (p: { text: string }) => `Vorschlag: „${p.text}“. Tab übernimmt ihn, Esc blendet ihn aus.`,
  'suggest.group': 'Schreiben',
  'suggest.groupDesc': 'Wie dir die App beim Schreiben in den Chats hilft.',
  'suggest.title': 'Vorschläge beim Tippen',
  'suggest.hint': 'Grauer Text nach dem Cursor: Tab übernimmt ihn, Esc blendet ihn aus, jede andere Taste ignoriert ihn. Zuerst aus deinen früheren Nachrichten, den „/“-Befehlen, den Rollen, den Chats und den Dateien: null Token.',
  'suggest.model': 'Das Modell fragen, wenn sonst nichts passt',
  'suggest.modelHint': 'Nur nach einer Tipp-Pause, mit der letzten Zeile und der letzten Nachricht des Chats, auf dem kleinsten Modell des API-Schlüssels. Gleiche Antworten kommen aus dem Cache, ohne Token.',
  'suggest.budget': 'Tagesbudget des Modells ($)',
  'suggest.budgetHint': 'Ist es erreicht, pausiert das Modell bis morgen; die lokalen Vorschläge bleiben.',
  'suggest.budgetBad': 'Ein Betrag von 0,01 bis 1 $.',
  'suggest.today': (p: { usd: string; limit: string; calls: number; hits: number }) => `Heute ${p.usd} von ${p.limit} · ${p.calls} Aufrufe · ${p.hits} aus dem Cache`,
  'suggest.kpi': 'Vorschläge heute',
  'suggest.kpiSub': (p: { calls: number; hits: number; limit: string }) => `${p.calls} Aufrufe, ${p.hits} aus dem Cache · Budget ${p.limit}`,
  'suggest.kpiOff': 'Modell aus: nur lokale Vorschläge, null Token',
  'suggest.kpiHelp': 'Was der graue Text beim Tippen in den Chats heute gekostet hat, wenn die lokalen Quellen nichts hatten. Zum Listenpreis, auf dem API-Schlüssel.',
};
