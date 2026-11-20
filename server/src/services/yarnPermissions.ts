export const yarnActions = ['receiving', 'profile', 'transfer', 'external', 'import', 'settlement'] as const;
export type YarnAction = typeof yarnActions[number];
/** A granular assignment opts out of legacy broad access (cost-view alone does not). */
export function canYarn(user: {role: string; permissions: string[]} | null | undefined, action: YarnAction): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const granular = yarnActions.some(a => user.permissions.includes(`inventory.yarn.${a}`));
  return user.permissions.includes(`inventory.yarn.${action}`) || (!granular && user.permissions.includes('inventory.manage'));
}

export function yarnMutationActions(path:string,body:unknown):YarnAction[] {
 const data=(body&&typeof body==='object'?body:{}) as {type?:string;shortageKg?:unknown};
 if(path.includes('/profiles')||path.includes('/minimum-stock'))return ['profile'];
 if(path.includes('/opening/'))return ['import'];
 if(path.includes('/external/'))return Number(data.shortageKg??0)>0?['external','settlement']:['external'];
 if(path.includes('/stock-operation'))return [data.type==='TRANSFER'?'transfer':'settlement'];
 return ['receiving'];
}
