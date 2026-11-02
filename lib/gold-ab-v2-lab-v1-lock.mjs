// Reversible V1 pairing lock for the disposable A/B V2 lab only.
// The two-key scope guard cannot disable the normal Gold V1 fallback.
// Lab-only experimental signed-Owner-Wall B flow: local authenticated Owner
// plus server-verified device proof and B, no separate visible Account code.
// Never enable outside the disposable abv2lab01/V1-locked environment.
export function goldAbV2LabWallBOnly(env=process.env){
 return goldAbV2LabV1Disabled(env)&&
   env.LR_GOLD_ABV2_LAB_SIGNED_WALL_B_ONLY==='1';
}
export function goldAbV2LabV1Disabled(env=process.env){
 return env.LR_GOLD_INSTANCE_ID==='abv2lab01'&&
   env.LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1==='1';
}
