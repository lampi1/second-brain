// Packaged presentation IDs only. UI preferences never load external CSS, code or executable extension manifests.
export const APPEARANCE_PRESETS=['standard','calm'] as const;
export const AGENT_TEMPLATES=['grid','list'] as const;
export interface AppearancePreference{version:1;preset:typeof APPEARANCE_PRESETS[number];templates:{agents:typeof AGENT_TEMPLATES[number]}}
export const defaultAppearance=():AppearancePreference=>({version:1,preset:'standard',templates:{agents:'grid'}});
export function readAppearance(value:unknown):AppearancePreference{
  if(!value||typeof value!=='object'||Array.isArray(value))return defaultAppearance();
  const v=value as Partial<AppearancePreference>;
  if(v.version!==1||!APPEARANCE_PRESETS.includes(v.preset!)||!v.templates||!AGENT_TEMPLATES.includes(v.templates.agents))return defaultAppearance();
  return {version:1,preset:v.preset!,templates:{agents:v.templates.agents}};
}
