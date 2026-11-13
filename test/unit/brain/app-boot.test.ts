// The always-loaded text of a fresh brain (rules/instructions.ts appBoot): its safety lines name the same three things
// the app holds for the owner's yes (ADR 0275) and nothing stricter, so a brain's own rules never meet an opposite one.
import { describe, expect, it } from 'vitest';
import { appBoot } from '../../../src/main/rules/instructions';

describe('appBoot: the safety a fresh brain starts with', () => {
  const text = appBoot('/home/me/brain').replace(/\s+/g, ' ');
  it('only database writes, production releases and cloud writes wait for the owner', () => {
    expect(text).toContain('only three things wait for the owner');
    expect(text).toContain('writes to a database');
    expect(text).toContain('releases and deploys to production');
    expect(text).toContain('writes to cloud resources');
    expect(text).toContain('reading production included');
  });
  it('credentials are used, never shown or stored', () => {
    expect(text).toContain('never print one or write one into a file or a chat');
    expect(text).not.toContain('must not be read');
    expect(text).not.toContain('never execute them');
  });
});
