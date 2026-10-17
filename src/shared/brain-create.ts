// Native-picker-only creation of a new personal memory, consumed by main and the first-run renderer.
import type { Harness } from './contract';

export interface BrainCreationCapability { available: boolean; reason?: string }
/** A new folder name only; main chooses its parent through the native picker. */
export interface CreateBrainRequest { name: string; role: string; language: 'it' | 'en'; harness: Harness; folderName: string }
/** A later user choice of another brain must not be overwritten by a slow creation. */
export interface CreatedBrain { root: string; connected: boolean }
