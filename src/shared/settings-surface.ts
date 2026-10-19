// Presentation inventory only. Classification never changes stored configuration, trust or engine permissions.
export type SettingSurface='essential'|'derived'|'retired'|'technical';
export function settingSurface(key:string):{surface:SettingSurface;place:string}{
 if(['language','brainRoot','autoCloseMin','osToasts'].includes(key))return{surface:'essential',place:'settings'};
 if(key.startsWith('engineOn.')||key==='codexAutonomyRoots')return{surface:'essential',place:'tool-connection'};
 if(key==='view'||key==='messaging.crossHarness')return{surface:'retired',place:'retired-setting'};
 if(key.startsWith('orchestratorChats.')||key.startsWith('routing.')||key.startsWith('engines.')||['launchRulesClaude','launchRulesCodex'].includes(key))return{surface:'derived',place:'agent-capability-or-existing-policy'};
 return{surface:'technical',place:key==='codexAutonomyRoots'?'development-context':'diagnostics-or-feature-context'};
}
