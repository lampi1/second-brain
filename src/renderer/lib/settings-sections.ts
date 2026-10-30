// The Settings page's sections (components/SettingsPage.tsx renders them, one card each): id, title, one-line
// description and the words its search matches, in the UI language. Apart from the page so the Orchestrator's app map
// (lib/app-map.ts, app_guide) lists the same sections the user sees, from the same source. Used by SettingsPage.tsx and
// lib/app-map.ts.
import { t } from '../i18n';

export interface SettingsSection { id: string; title: string; description: string; search: string }

/** The sections in page order. engineNames: the engines listed under «Account» (their names are searchable). */
export function settingsSections(engineNames: readonly string[]): Record<SettingsSectionId, SettingsSection> {
  return {
    profile: { id: 'profile', description:t('essential.desc.profile'),title:t('profile.group'),search:[t('profile.name'),t('profile.role'),t('profile.mainWork'),t('profile.replyStyle'),'me.md profilo profile'].join(' ') },
    update: { id: 'update', description:t('essential.desc.update'),title:t('update.group'),search:'aggiorna update versione version GitHub' },
    connectors: { id: 'connectors', description:t('essential.desc.connectors'),title:t('connector.group'),search:'GitHub Jira Azure DevOps collegamenti connectors projects MCP server strumenti tools token importa import Claude Cursor Codex' },
    accounts: { id: 'accounts', description:t('essential.desc.accounts'),title:t('essential.accounts'),search:engineNames.join(' ')+' '+t('autonomy.title') },
    roles: { id: 'roles', description:t('delegation.desc'),title:t('delegation.group'),search:'ruoli roles deleghe delegation profondità depth parallelo parallel revisioni reviews Sentinel modelli models livelli tiers' },
    space: { id: 'space', description:t('essential.desc.space'),title:t('essential.space'),search:[t('essential.memory'),t('share.title'),'zip esporta export colleghi condividi share',t('essential.archive'),t('setup.settings.projects'),'ruolo role Dev QA PO CTO progetti projects repository'].join(' ') },
    writing: { id: 'writing', description:t('suggest.groupDesc'),title:t('suggest.group'),search:[t('suggest.title'),'tab autocomplete suggerimenti suggestions'].join(' ') },
    voice: { id: 'voice', description:t('voice.groupDesc'),title:t('voice.group'),search:[t('voice.asrTitle'),t('voice.nameTitle'),t('voice.modelsTitle'),'voce microfono whisper piper parla ascolta voice mic speech Ctrl+M'].join(' ') },
    appearance: { id: 'appearance', description:t('essential.desc.appearance'),title:t('essential.appearance'),search:[t('essential.theme'),t('settings.language'),t('essential.density')].join(' ') },
    notifications: { id: 'notifications', description:t('essential.desc.notifications'),title:t('essential.notifications'),search:`${t('essential.toasts')} ${t('brainPages.task.autoLabel')} ${t('brainPages.task.sound')} Task` },
    advanced: { id: 'advanced', description:t('hub.adv.groupDesc'),title:t('hub.adv.group'),search:'MCP server stdio http comando command argomenti args env variabili headers intestazioni importa import Claude Cursor Codex avanzate advanced' },
  };
}
export const SETTINGS_SECTION_IDS = ['profile', 'update', 'connectors', 'accounts', 'roles', 'space', 'writing', 'voice', 'appearance', 'notifications', 'advanced'] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

/** The left navigation of Settings (ADR 0207): the sections in labelled groups, like macOS System Settings, each with
 *  the tone of its icon tile. Plain strings: a section removed elsewhere just stops showing, and one not listed here (a
 *  section added later) joins the last group, so it never disappears from the navigation. */
export type SettingsNavLabel = 'you' | 'work' | 'tools' | 'app';
export const SETTINGS_NAV: readonly { label: SettingsNavLabel; ids: readonly string[] }[] = [
  { label: 'you', ids: ['profile', 'appearance', 'notifications', 'voice', 'writing'] },
  { label: 'work', ids: ['space', 'roles'] },
  { label: 'tools', ids: ['connectors', 'accounts', 'advanced'] },
  { label: 'app', ids: ['update'] },
];
export const SETTINGS_TONE: Readonly<Record<string, string>> = {
  profile: 'blue', appearance: 'purple', notifications: 'red', voice: 'pink', writing: 'amber', space: 'green', roles: 'teal',
  connectors: 'blue', accounts: 'slate', advanced: 'slate', update: 'green',
};

/** The navigation's groups holding only the sections that exist, in order; unknown ids join the last group. */
export function navGroups(ids: readonly string[]): { label: SettingsNavLabel; ids: string[] }[] {
  const known = new Set(SETTINGS_NAV.flatMap(g => g.ids));
  const out = SETTINGS_NAV.map(g => ({ label: g.label, ids: g.ids.filter(id => ids.includes(id)) }));
  out[out.length - 1]!.ids.push(...ids.filter(id => !known.has(id)));
  return out.filter(g => g.ids.length > 0);
}
