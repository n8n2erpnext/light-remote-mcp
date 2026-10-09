// Bound repeated failed lease renewals. Keep retrying before hard expiry,
// but never let a missing edge route create a request storm on short poll loops.
export function cloudRenewBackoffDelayMs({failures=1,status=0,retryAfterMs=0,hardExpiresAt=null,now=Date.now(),random=0.5}={}) {
  const attempt=Math.max(1,Math.min(20,Math.floor(Number(failures)||1)));
  const http=Number(status)||0;
  const base=http===404?60_000:[401,403].includes(http)?120_000:http===429?30_000:15_000;
  const exponential=Math.min(10*60_000,base*2**Math.min(attempt-1,8));
  const r=Number.isFinite(Number(random))?Math.max(0,Math.min(1,Number(random))):0.5;
  let delay=Math.max(exponential*(0.9+0.2*r),Math.max(0,Number(retryAfterMs)||0));
  const expires=Number(hardExpiresAt);
  if(Number.isFinite(expires)&&expires>0&&expires>now){
    // Preserve more than one opportunity before the server's hard expiry.
    delay=Math.min(delay,Math.max(3_000,Math.floor((expires-now)/3)));
  }
  return Math.max(3_000,Math.round(delay));
}
