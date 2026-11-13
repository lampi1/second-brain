// The choices of Settings → Avanzate «Coda e avvii» (ADR 0222): cold-start slots and the emergency brake's CPU and
// free-RAM thresholds, each a short list that always holds the saved value and stays inside the schema's range
// (main/brain/settings-schema.ts: slots 0..64, CPU 30..100, RAM 0..90). Used by components/QueueSettings.tsx.

const sorted = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

/** 0 (= automatic) then 1..cores (at most 16 rows), plus the saved value */
export function slotChoices(cores: number, saved: number): number[] {
  const top = Math.max(1, Math.min(16, cores));
  return sorted([0, ...Array.from({ length: top }, (_, i) => i + 1), Math.min(64, Math.max(0, saved))]);
}

export function cpuChoices(saved: number): number[] {
  return sorted([70, 80, 90, 95, 98, 100, Math.min(100, Math.max(30, saved))]);
}

/** 0 = the brake ignores RAM */
export function ramChoices(saved: number): number[] {
  return sorted([0, 5, 10, 15, 20, 30, Math.min(90, Math.max(0, saved))]);
}
