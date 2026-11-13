// Pair asynchronous image reads with the exact visible path list, including the first render after a list change.
import type {AskImageResult} from '@shared/contract';
export interface ImageResults {key:string;values:(AskImageResult|null)[]}
export const imageResultsKey=(paths:readonly string[])=>JSON.stringify(paths);
export function currentImageResults(paths:readonly string[],loaded:ImageResults):(AskImageResult|null)[]{
  return loaded.key===imageResultsKey(paths)&&loaded.values.length===paths.length?loaded.values:paths.map(()=>null);
}
