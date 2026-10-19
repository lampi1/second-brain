// Everyday work briefs preserve the request, add useful context and keep publication authorization explicit.
import { describe, expect, it } from 'vitest';
import { WORK_PATHS, workBrief } from '../../src/shared/work-brief';

describe('everyday work brief', () => {
  it('preserves context/outcome for a Orchestrator with an optional first message', () => {
    const brief = workBrief({ path: 'client', request: ' ', context: 'A customer', outcome: 'Follow-up' });
    expect(brief).toContain('A customer'); expect(brief).toContain('Follow-up');
    expect(workBrief({ path: 'general', request: '', context: '', outcome: '' })).toBe('');
  });
  it('keeps each requested deliverable and context in every adaptable work path', () => {
    for (const path of WORK_PATHS) {
      const brief = workBrief({ path, request: '  Prepare tomorrow’s meeting  ', context: 'Audience: operations team', outcome: 'One-page agenda' });
      expect(brief.startsWith('Prepare tomorrow’s meeting\n')).toBe(true);
      expect(brief).toContain('Audience: operations team');
      expect(brief).toContain('One-page agenda');
      expect(brief).toContain('do not authorize sending messages');
    }
  });
  it('does not impose code work on ordinary tasks', () => {
    const brief = workBrief({ path: 'write', request: 'Draft a proposal', context: '', outcome: '' });
    expect(brief).toContain('Prepare a draft');
    expect(brief).not.toContain('Read the project instructions');
    expect(brief).not.toContain('Context supplied');
  });
});
