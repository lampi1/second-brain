// Renderer-only pack requests and drop filtering. Main resolves every file path and owns review tokens.
export type PackRequest = { kind: 'import'; dropped?: string } | { kind: 'export'; id: string };
export const PACK_EVENT = 'sb-agent-pack';
export function requestPack(request: PackRequest): void { window.dispatchEvent(new CustomEvent(PACK_EVENT, { detail: request })); }
export function acceptsPackDrop(name: string, directory: boolean): boolean { return directory || /\.(sbagent|zip)$/i.test(name); }
