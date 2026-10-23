// Yes/no questions only (shared/yes-no.ts, ADR 0135): the shape check the question gates use and when the gate is on.
import { describe, expect, it } from 'vitest';
import { isYesNo, yesNoGateOn, yesNoOf, yesNoShape } from '../../src/shared/yes-no';

const q = (...labels: string[]) => ({ options: labels.map(label => ({ label })), multiSelect: false });

describe('yes/no questions', () => {
  it('reads Sì / No in the app languages, with the recommended mark and punctuation aside', () => {
    expect(yesNoOf('Sì (consigliato)')).toBe('yes');
    expect(yesNoOf('si')).toBe('yes');
    expect(yesNoOf('Yes (recommended)')).toBe('yes');
    expect(yesNoOf('Ja')).toBe('yes');
    expect(yesNoOf('No.')).toBe('no');
    expect(yesNoOf('Nein')).toBe('no');
    expect(yesNoOf('Sì, procedi')).toBeNull();
    expect(yesNoOf('Blu')).toBeNull();
  });
  it('a question is yes/no with exactly a yes and a no, single choice', () => {
    expect(isYesNo(q('Sì (consigliato)', 'No'))).toBe(true);
    expect(isYesNo(q('No', 'Sì'))).toBe(true);
    expect(isYesNo(q('Sì', 'Sì'))).toBe(false);
    expect(isYesNo(q('Blu', 'Rosso'))).toBe(false);
    expect(isYesNo(q('Sì', 'No', 'Forse'))).toBe(false);
    expect(isYesNo({ ...q('Sì', 'No'), multiSelect: true })).toBe(false);
  });
  it('a request is yes/no when every question is, and it has one', () => {
    expect(yesNoShape([q('Sì', 'No'), q('Yes', 'No')])).toBe(true);
    expect(yesNoShape([q('Sì', 'No'), q('A', 'B')])).toBe(false);
    expect(yesNoShape([])).toBe(false);
  });
  it('the gate is on in a real profile, off in the test suites unless asked, SB_YESNO=0 turns it off', () => {
    expect(yesNoGateOn({})).toBe(true);
    expect(yesNoGateOn({ SB_YESNO: '0' })).toBe(false);
    expect(yesNoGateOn({ SB_TEST: '1' })).toBe(false);
    expect(yesNoGateOn({ VITEST: 'true', SB_YESNO: '1' })).toBe(true);
  });
});
