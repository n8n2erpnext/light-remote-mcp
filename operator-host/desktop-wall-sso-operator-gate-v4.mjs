/**
 * T04b6 — explicit opt-in Operator startup gate for Desktop -> Local Wall SSO.
 *
 * This is NOT a public issue endpoint. The Operator can ONLY expose the
 * enrolled-device-signed ticket redemption callback when *all* independent
 * consent/authority gates are enabled. With any missing, mistyped or partial
 * flag, the T04b4 route remains 404 before reading caller input.
 *
 * Do not enable these flags on Gold production or normal Lab. No native
 * ticket issuer, signed device relay or secure Wall bootstrap exists yet.
 */
import {createDesktopWallSsoTrustedOperatorV4}
  from './desktop-wall-sso-trusted-authority-v4.mjs';

export const DESKTOP_WALL_SSO_OPERATOR_REQUIRED_FLAGS=Object.freeze([
  'LIGHT_REMOTE_GOLD_INDEPENDENT',
  'LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4',
  'LR_GOLD_ABV2_DESKTOP_TOKEN_V4',
  'LR_GOLD_ABV2_DESKTOP_WALL_SSO_V4',
  'LR_GOLD_ABV2_DESKTOP_WALL_SSO_OPERATOR_V4'
]);

export const DESKTOP_WALL_SSO_ISSUER_FLAG_V4='LR_GOLD_ABV2_DESKTOP_WALL_SSO_ISSUER_V4';

export function desktopWallSsoOperatorEnabledV4(env={}){
  if(!env||typeof env!=='object'||Array.isArray(env))return false;
  // Exact opt-in. Incomplete, empty, mixed, or truthy-but-not-1 flags are OFF.
  return DESKTOP_WALL_SSO_OPERATOR_REQUIRED_FLAGS.every(
    flag=>env[flag]==='1'
  );
}

export function createDesktopWallSsoOperatorGateV4({
  env={},storage,accounts,enrollments
}={}){
  if(!desktopWallSsoOperatorEnabledV4(env))
    return Object.freeze({
      enabled:false, signedRedeem:undefined, internalIssue:undefined,
      authority:null
    });
  const service=createDesktopWallSsoTrustedOperatorV4({
    enabled:true,redis:storage?.redis,prefix:storage?.prefix,
    accounts,enrollments
  });
  if(service.enabled!==true||typeof service.redeem!=='function')
    throw new Error('desktop_wall_sso_operator_authority_unavailable');
  // Only the signed device-channel route receives the callback.
  // Ticket issue and Wall session assertion are intentionally NOT routed.
  return Object.freeze({
    enabled:true,signedRedeem:service.redeem,
    internalIssue:env[DESKTOP_WALL_SSO_ISSUER_FLAG_V4]==='1'
      ?service.issue:undefined,
    authority:service
  });
}
