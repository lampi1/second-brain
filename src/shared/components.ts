// Inert, content-addressed component catalog contracts. Imported knowledge never grants tools or executes installers.
import type { FlowDefinition } from './flows';
export interface ComponentSource { repository: string; ref: string; directory: string; enabled: boolean }
export interface ComponentEntry { path: string; kind: 'agent' | 'skill' | 'command' | 'reference'; title: string; sha: string }
export interface ComponentCatalog { source: ComponentSource; commit: string; fetchedAt: number; entries: ComponentEntry[] }
export interface ComponentFile { path: string; content: string; sha256: string }
export interface ComponentBundle {
  schema: 1; digest: string; origin: { repository?: string; commit?: string; path: string };
  files: ComponentFile[]; findings: { severity: 'block' | 'review'; code: string; path?: string }[];
  license: 'included' | 'unknown'; createdAt: number;
}
export interface ComponentState { sources: ComponentSource[]; catalogs: ComponentCatalog[]; bundles: ComponentBundle[]; error?: string }
export interface ComponentDiff { added: string[]; removed: string[]; changed: string[]; unchanged: number }
/** Tool responses are manifests by default; individual file text is fetched in bounded pages on demand. */
export type ComponentManifest = Omit<ComponentBundle, 'files'> & { files: { path: string; sha256: string; characters: number }[] };
export type ComponentOperation =
  | { op: 'state' }
  | { op: 'source'; source: ComponentSource }
  | { op: 'refresh'; repository: string }
  | { op: 'search'; query: string; limit?: number }
  | { op: 'stage'; repository: string; commit: string; path: string }
  | { op: 'local'; files: { path: string; content: string }[]; name: string }
  | { op: 'inspect'; digest: string; previous?: string }
  | { op: 'propose'; digest: string; definition?: FlowDefinition; definitionPath?: string; expectedRevision: number; assets: { path: string; id: string }[]; stepIds: string[] };
export interface ComponentResult { state?: ComponentState; matches?: (ComponentEntry & { repository: string; commit: string })[]; bundle?: ComponentBundle; diff?: ComponentDiff; proposal?: { flowId: string; revision: number } }
