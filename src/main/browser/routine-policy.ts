// Host browser authority for one bound routine step; exact origins and revocation, never model-provided grants.
export interface RoutineBrowserPolicy { targets: readonly string[]; reason?: string; dispatch(): void }
export type RoutineBrowserAccess = (chatId: string) => RoutineBrowserPolicy | null;
export function assertBrowserOrigin(policy: RoutineBrowserPolicy, url: string): void {
  if (policy.reason) throw new Error(policy.reason);
  let u: URL; try { u = new URL(url); } catch { throw new Error('Routine browser: invalid destination'); }
  if (u.username || u.password || !policy.targets.includes(u.origin)) throw new Error(`Routine browser: origin ${u.origin} is outside approved browserTargets. Propose and approve a new routine version.`);
}
export const BROWSER_INTERACTIONS = new Set(['click', 'hover', 'drag', 'type', 'key', 'scroll', 'select_option', 'fill_form', 'handle_dialog', 'browser_login']);
