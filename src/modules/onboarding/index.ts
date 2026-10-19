// Registry descriptor: the integrator mounts this same screen in setup and exposes its action from Orchestrator.
export { OnboardingScreen, OrchestratorConnectAction } from './Screen';
export type { OnboardingPort, Plan, Request, Applied, Discovery, Connection } from './contract';
export const onboardingModule = { id: 'onboarding-connectors', version: 1, surfaces: ['setup', 'orchestrator'] as const };
