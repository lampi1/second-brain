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
