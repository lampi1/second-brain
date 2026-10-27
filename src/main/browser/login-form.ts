// The routine login form rules now live in the shared routine runtime (ADR 0175): this shim keeps the app's imports.
// Used by site-login.ts (Electron tab) and its unit test.
export * from '../../../packages/routine-runtime/src/login-form';
