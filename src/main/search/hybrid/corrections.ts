// Semantic correction detection for the prompt hook (SPEC 23c). HybridSearch supplies its warm local embedder;
// only logged said/true pairs are positives. Contrastive request examples keep topic recall separate from intent.
// No messages are saved, no model is loaded here, and unavailable/busy state asks the hook to use its regex.
import { cosine } from './engine';
import type { ThemeEntry } from '@shared/themes';

export interface Correction { ready: boolean; correction: boolean }
export const CORRECTION_UNAVAILABLE: Correction = { ready: false, correction: false };
// Conservative initial policy, not a measured accuracy claim. Real-message calibration needs owner permission.
export const CORRECTION_MIN = 0.86;
export const CORRECTION_MARGIN = 0.025;
export const NEUTRAL = [
  'Spiegami questa storia.', 'Non capisco questo argomento, puoi spiegarmelo?',
  'Explain how this works.', 'Please implement this feature.', 'Grazie, funziona bene.',
];

export function correctionExamples(entries: ThemeEntry[]): { positive: string[]; negative: string[] } {
  const positive: string[] = [], negative = [...NEUTRAL];
  for (const entry of entries.slice(-300)) {
    const said = entry.text.match(/(?:^| · )detto:\s*(.*?)(?= · |$)/i)?.[1]?.trim().slice(0, 500);
    const truth = entry.text.match(/(?:^| · )vero:\s*(.*?)(?= · |$)/i)?.[1]?.trim().slice(0, 500);
    if (!said || !truth) continue;
    positive.push(`Hai detto: ${said}. In realtà: ${truth}.`);
    negative.push(`Spiegami: ${truth}.`, `Vorrei che tu facessi questo: ${truth}.`);
  }
  return { positive, negative };
}

export function isCorrection(q: Float32Array, positive: Float32Array[], negative: Float32Array[]): boolean {
  const best = (vs: Float32Array[]) => Math.max(-1, ...vs.map(v => cosine(q, v)));
  const score = best(positive);
  return score >= CORRECTION_MIN && score - best(negative) >= CORRECTION_MARGIN;
}

export class CorrectionDetector {
  private cache: { root: string; key: string; positive: Float32Array[]; negative: Float32Array[] } | null = null;
  private warming = false;
  private querying = false;
  constructor(private deps: {
    root: () => string | null;
    ready: () => boolean;
    entries: () => Promise<ThemeEntry[]>;
    passages: (texts: string[]) => Promise<Float32Array[]>;
    query: (text: string) => Promise<Float32Array[] | null>;
  }) {}

  /** Refresh in the background; the prompt never waits for corpus embedding or a worker queue to drain. */
  warm(): void {
    const root = this.deps.root();
    if (!root || !this.deps.ready() || this.warming) return;
    this.warming = true;
    void this.deps.entries().then(async entries => {
      const examples = correctionExamples(entries);
      const key = JSON.stringify(examples);
      if (this.cache?.root === root && this.cache.key === key) return;
      const vectors = await this.deps.passages([...examples.positive, ...examples.negative]);
      if (this.deps.root() !== root || !this.deps.ready()) return;
      this.cache = { root, key, positive: vectors.slice(0, examples.positive.length), negative: vectors.slice(examples.positive.length) };
    }).catch(() => { /* unavailable: retry on the next warm lookup */ }).finally(() => { this.warming = false; });
  }

  async detect(text: string): Promise<Correction> {
    const root = this.deps.root();
    if (!root || !this.deps.ready()) return CORRECTION_UNAVAILABLE;
    this.warm();
    const cache = this.cache;
    if (!cache || cache.root !== root || !cache.positive.length || this.querying) return CORRECTION_UNAVAILABLE;
    this.querying = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Keep querying set until the underlying work finishes, including after the deadline: no unbounded queue.
    const work = Promise.resolve().then(() => this.deps.query(text.slice(0, 4000)))
      .then(vs => vs?.[0] && this.deps.root() === root && this.deps.ready()
        ? { ready: true, correction: isCorrection(vs[0], cache.positive, cache.negative) } : CORRECTION_UNAVAILABLE)
      .catch(() => CORRECTION_UNAVAILABLE).finally(() => { this.querying = false; });
    try {
      return await Promise.race([work, new Promise<Correction>(resolve => {
        timer = setTimeout(() => resolve(CORRECTION_UNAVAILABLE), 180);
      })]);
    } finally { clearTimeout(timer); }
  }
}
