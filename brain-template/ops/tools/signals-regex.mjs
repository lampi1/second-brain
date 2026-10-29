// Regexes that recognise {{OWNER}}'s corrections and confusion in a message. One copy, shared by `flow-signals.mjs`
// (counting) and the `correction-catch` hook (reminder to log the error in `ai-errors.md`, P-042).
// Each alternative ends at a word boundary ("non vale", "non funzionano" are not "non va", "non funziona"); a plain
// question ("come mai…?", "perché non…?") is not a correction: it counts only with "ma" in front ("ma perché non…").
export const CORRECTION = /\b(no[,.!]|no$|non (così|va|è|devi|serve|funziona)(?![\wàèéìòù])|ti ho (già )?detto|te l'ho detto|sbagliat|di nuovo|ancora una volta|ma (perché|come mai)|mai più|ricordati|smett|basta\b)/i;
export const CONFUSION = /(non (capisco|ho capito)|cosa (vuol dire|significa|intendi)|che (cos'è|vuol dire)|\?\?|in che senso|spiegami)/i;
// Explicit praise (feedback-log.mjs) (tuned on real messages, 2026-10-09): he praises at the
// START of a message ("ok perfetto, ora…", "Ora funziona, però…"); the same words later are mostly requests ("un piano
// perfetto", "vedere se funziona", "più grande"). So: a praise word after at most three fillers, or a few phrases that
// are praise anywhere (not in a question).
const FILLER = String.raw`(?:(?:o+k+|o\s?k|okay|si+|sì|allora|ora|adesso|bene|ah|beh|scherzo|finalmente|no|dai|wow|ottimo|perfetto)[\s,.!:;]+){0,3}`;
const PRAISE = String.raw`(?:perfett[oa]|ottim[oa]|benissimo|brav[oa]|bravissim[oa]|grande|fantastic[oa]|eccellente|top(?!\s+bar\b)|esatt[oa]|funziona(?:no)?(?!\s+(?:così|anche|male|quando|se|come)(?![\wàèéìòù]))|(?:mi )?sembra funzionare|(?:ora|adesso) va(?!\s+(?:in|fatt[oaie]|\w+(?:at|it|ut)[oaie])(?![\wàèéìòù]))|(?:questa |questo )?mi piace|geniale|grazie mille|ben fatto|spettacol[oa]|stupendo|bell[oa]|bellissim[oa]|figo|così va bene|va bene così|così benissimo|great|perfect|nice)`;
const ANYWHERE = String.raw`(?:ottimo lavoro|ben fatto|grazie mille|mi piace (?:un sacco|molto|tantissimo)|ottima idea|va bene così|così va bene|va bene come (?:hai|l'hai) fatto|(?:è|sono) perfett[oaie]|ha funzionato)`;
// "che figo/che bello" is praise even inside a question.
export const POSITIVE = new RegExp(String.raw`^\s*${FILLER}${PRAISE}(?![\wàèéìòù])(?!\s*\?)|(?<![\wàèéìòù])${ANYWHERE}(?![\wàèéìòù])(?![^.!\n]*\?)|\bche (?:figo|bello|spettacolo)\b`, 'i');
const NEGATED = /\bnon\s+(\w+\s+)?(funziona|va|mi piace|è (perfett|giust|esatt)|ha funzionato)/i;
// Praise with a new request, a doubt or a remaining problem in the same breath ("Ora funziona, però…").
const BUT = /\b(però|ma|tranne|mentre|solo)(?![\wàèéìòù])/i;
// Praise words around a plain "still wrong": not praise.
const STILL_WRONG = /sbagliat|ancora (non (va|funziona)|rott|sbagl)|non (va|funziona)\b|\bmale\b|\bin (errore|timeout|crash|500)\b|è un bug/i;
// null, 'positivo' or 'parziale'. The head only: a long paste that mentions "funziona" is not praise.
export const positiveKind = text => {
  const head = String(text ?? '').trim().slice(0, 160);
  if (!head || head.startsWith('<') || head.startsWith('/')) return null;
  if (!POSITIVE.test(head) || NEGATED.test(head) || STILL_WRONG.test(head)) return null;
  return BUT.test(head) || CONFUSION.test(head) || CORRECTION.test(head) ? 'parziale' : 'positivo';
};
export const isPositive = text => positiveKind(text) !== null;
