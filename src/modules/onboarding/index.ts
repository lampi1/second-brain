// Registry descriptor of the onboarding module (src/modules/registry.ts). Its old screen (Screen.tsx, Board.tsx, its own
// i18n.ts) was never mounted and is gone (ADR 0119): the setup wizard's tool tiles (renderer/components/ToolCatalog.tsx)
// and Settings → Connettori use this module's app connectors (app-*.ts) instead.
export type { OnboardingPort, Plan, Request, Applied, Discovery, Connection } from './contract';
export const onboardingModule = { id: 'onboarding-connectors', version: 1, surfaces: ['setup', 'orchestrator'] as const };
