// The first setup's new memory ('app:createBrain'): created empty in the app's data folder on confirm
// (modules/ai-first/default-brain.ts); there is no other way the app creates a brain (an existing one is linked).
import type { Harness, Lang } from './contract';

export interface CreateBrainRequest { language: Lang; harness: Harness | 'none' }
/** A later user choice of another brain must not be overwritten by a slow creation. */
export interface CreatedBrain { root: string; connected: boolean }
