// Brain area of the app: the pages of the brain (oggi, da fare, idee, costi, qualità, esplora) and the full-screen 3D
// map, in the app's own style, fed by the brain's data API (invoke 'brain:api'). This file is the ONE mount point the
// workspace UI imports: BrainPage renders a page by id; BrainMap is the full-screen map overlay. Built in feat/brain-ui.
export type BrainPageId = 'home' | 'adesso' | 'fatto' | 'dafare' | 'idee' | 'spunti' | 'costi' | 'qualita' | 'collabora' | 'confronto' | 'esplora';
export const BRAIN_PAGES: { id: BrainPageId; label: string; key: string }[] = [
  { id: 'home', label: 'Oggi', key: 'G H' },
  { id: 'adesso', label: 'Adesso', key: 'G A' },
  { id: 'fatto', label: 'Fatto e standup', key: 'G F' },
  { id: 'dafare', label: 'Da fare', key: 'G D' },
  { id: 'idee', label: 'Idee', key: 'G I' },
  { id: 'spunti', label: "Spunti dell'IA", key: 'G S' },
  { id: 'costi', label: 'Costi', key: 'G C' },
  { id: 'qualita', label: 'Qualità', key: 'G Q' },
  { id: 'collabora', label: 'Collaborazione', key: 'G L' },
  { id: 'confronto', label: 'Confronto modelli', key: 'G M' },
  { id: 'esplora', label: 'Esplora', key: 'G E' },
];

export function BrainPage({ id }: { id: BrainPageId; onNavigate?: (target: string) => void }) {
  return <div className="brain-page" data-testid={`brain-page-${id}`}>In arrivo: {BRAIN_PAGES.find(p => p.id === id)?.label}</div>;
}

export function BrainMap({ onClose }: { onClose: () => void }) {
  return <div className="brain-map" data-testid="brain-map" role="dialog" aria-label="Mappa del cervello"><button onClick={onClose}>Chiudi</button></div>;
}
