// GoldABV2 product policy: V1 is permanently disabled in this product line.
// The regular Gold product remains independent and retains its own legacy
// compatibility. No /admin or environment flag may re-enable V1 in GoldABV2.
// Device authorization always requires the signed per-Agent B proof.
export function goldAbV2LabWallBOnly(env=process.env){
 return goldAbV2LabV1Disabled(env)&&
   env.LR_GOLD_ABV2_LAB_SIGNED_WALL_B_ONLY==='1';
}
export function goldAbV2LabV1Disabled(env=process.env){
 return ['abv2lab01','goldabv2','goldabv2-production'].includes(
    String(env.LR_GOLD_INSTANCE_ID||'').toLowerCase()) ||
   env.LR_GOLD_PRODUCT_LINE==='goldabv2' ||
   /^https:\/\/goldabv2\.light-remote\.thaiduy\.digital\/?$/.test(
    String(env.OPERATOR_AGENT_BASE_URL||''));
}
