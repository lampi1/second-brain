// Verify host-only capture removes both login values before child environment inheritance.
import { expect, it } from 'vitest';
import { captureTestDbCredentials } from '../../src/main/flows/test-db-env';
it('captures only dedicated SQL login names and removes them from the inherited environment', () => {
  const env = { SQLCMD_TEST_RO_USER: 'fixture-reader', SQLCMD_TEST_RO_PASSWORD: 'fixture-value', OTHER: 'keep' };
  const read = captureTestDbCredentials(env);
  expect(env).toEqual({ OTHER: 'keep' });
  expect(read('SQLCMD_TEST_RO_USER')).toBe('fixture-reader');
  expect(read('SQLCMD_TEST_RO_PASSWORD')).toBe('fixture-value');
  expect(read('OTHER')).toBeUndefined();
  expect(captureTestDbCredentials(env)('SQLCMD_TEST_RO_PASSWORD')).toBeUndefined();
});
