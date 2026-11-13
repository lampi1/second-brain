// Capture the dedicated test SQL login in the host before engines start; never inherit it into child processes.
// This limits accidental disclosure, not access by another program running as the same operating-system user.
const names = ['SQLCMD_TEST_RO_USER', 'SQLCMD_TEST_RO_PASSWORD'] as const;
export function captureTestDbCredentials(environment: NodeJS.ProcessEnv): (name: string) => string | undefined {
  const captured = new Map<string, string>();
  for (const name of names) {
    const value = environment[name];
    if (value) captured.set(name, value);
    delete environment[name];
  }
  return name => captured.get(name);
}
export const testDbCredential = captureTestDbCredentials(process.env);
