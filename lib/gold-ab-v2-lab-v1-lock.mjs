// Reversible V1 pairing lock for the disposable A/B V2 lab only.
// The two-key scope guard cannot disable the normal Gold V1 fallback.
export function goldAbV2LabV1Disabled(env=process.env){
 return env.LR_GOLD_INSTANCE_ID==='abv2lab01'&&
   env.LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1==='1';
}
