// Tabs the user closed under an agent (✕ or Ctrl+W on its browser tile), remembered per tab group so the agent's next
// call on them fails with a clear error instead of a vague "no tab" or, worse, landing on another tab: when the user
// closes the agent's ACTIVE tab, the group keeps no active tab until the agent picks one (tabs_select or tabs_create;
// a navigate without tabId fails too, so it never reopens the page the user just closed), and a call without tabId
// never acts silently on a page the agent did not choose.
// Pure (no Electron): used by browser/tabs.ts and unit-tested in test/unit/browser-closed.test.ts.

const MAX_PER_GROUP = 20;

interface Closed { url: string }
interface GroupClosed { tabs: Map<string, Closed>; active: string | null }

export class UserClosed {
  private readonly groups = new Map<string, GroupClosed>();

  /** The user closed tab `id` of `group` in the app; `wasActive` = it was the agent's active tab. */
  mark(group: string, id: string, url: string, wasActive: boolean): void {
    let g = this.groups.get(group);
    if (!g) { g = { tabs: new Map(), active: null }; this.groups.set(group, g); }
    g.tabs.set(id, { url });
    if (g.tabs.size > MAX_PER_GROUP) g.tabs.delete(g.tabs.keys().next().value!);
    if (wasActive) g.active = id;
  }

  /** The active tab the user closed, while the agent has not picked another one; null = none. */
  closedActive(group: string): string | null { return this.groups.get(group)?.active ?? null; }

  /** The error for an agent call on `tabId` (or, without one, on its active tab) that the user closed; null = not a
   *  tab the user closed. `others` = the agent's tabs still open, named so it can pick one. */
  errorFor(group: string, tabId: string | null, others: string[]): string | null {
    const g = this.groups.get(group);
    const id = tabId ?? g?.active ?? null;
    const c = id ? g?.tabs.get(id) : undefined;
    if (!id || !c) return null;
    const next = others.length
      ? `Your open tabs: ${others.join(', ')}. Call tabs_select to pick one, or tabs_create to open a new tab.`
      : 'You have no open tab now: call tabs_create to open one (ask the user first if you need the page they closed).';
    return `The user closed tab ${id}${c.url ? ` (${c.url})` : ''} in the app. ${next}`;
  }

  /** The agent picked or opened a tab: calls without tabId go to it again. */
  picked(group: string): void { const g = this.groups.get(group); if (g) g.active = null; }

  /** The group is gone (its chat closed, its MCP session ended). */
  forget(group: string): void { this.groups.delete(group); }
}
