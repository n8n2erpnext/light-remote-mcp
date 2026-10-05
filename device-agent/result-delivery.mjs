export const RESULT_DELIVERY_BUDGET_BYTES=3*1024*1024;
export const RESULT_413_RETRY_BUDGET_BYTES=512*1024;

const jsonBytes=value=>Buffer.byteLength(JSON.stringify(value));
const safeStatus=value=>['ok','error','timeout'].includes(String(value||''))?String(value):'error';

function utf8Slice(value,maxBytes){
  const text=String(value??''),limit=Math.max(0,Number(maxBytes)||0);
  if(!text||limit===0)return '';
  if(Buffer.byteLength(text)<=limit)return text;
  let low=0,high=text.length,best=0;
  while(low<=high){
    let mid=Math.floor((low+high)/2);
    if(mid>0&&mid<text.length&&/[\uD800-\uDBFF]/.test(text[mid-1])&&/[\uDC00-\uDFFF]/.test(text[mid]))mid--;
    const bytes=Buffer.byteLength(text.slice(0,mid));
    if(bytes<=limit){best=mid;low=mid+1;}else high=mid-1;
  }
  return text.slice(0,best);
}

function compactData(data,status,maxBytes){
  if(data===undefined)return undefined;
  let size=0;
  try{size=jsonBytes(data);}catch{size=maxBytes+1;}
  const cap=Math.min(512*1024,Math.max(16*1024,Math.floor(maxBytes/3)));
  if(size<=cap)return data;
  const source=data&&typeof data==='object'&&!Array.isArray(data)?data:{};
  const compact={ok:status==='ok',truncated:true,delivery:'device-result',originalBytes:size};
  if(status!=='ok'&&source.error!=null)compact.error=String(source.error).slice(0,512);
  if(Number.isFinite(Number(source.status)))compact.status=Number(source.status);
  return compact;
}

export function fitResultForDelivery(result={},options={}){
  const source=result&&typeof result==='object'&&!Array.isArray(result)?result:{};
  const maxBytes=Math.max(64*1024,Number(options.maxBytes)||RESULT_DELIVERY_BUDGET_BYTES);
  let originalBytes=0;
  try{originalBytes=jsonBytes(source);}catch{originalBytes=maxBytes+1;}
  if(originalBytes<=maxBytes&&!options.forceCompact)return source;

  const status=safeStatus(source.status);
  const telemetry=source.telemetry&&typeof source.telemetry==='object'?{...source.telemetry}:undefined;
  const out={
    commandId:String(source.commandId||''),
    status,
    exitCode:Number.isInteger(Number(source.exitCode))?Math.max(0,Math.min(Number(source.exitCode),255)):(status==='ok'?0:1),
    stdout:'',
    stderr:'',
    durationMs:Math.max(0,Number(source.durationMs)||0),
    outputTruncated:true,
    deliveryOriginalBytes:originalBytes,
    ...(options.mark413?{deliveryCompactedAfter413:true}:{}),
    ...(telemetry?{telemetry}:{})
  };
  const data=compactData(source.data,status,maxBytes);
  if(data!==undefined)out.data=data;

  const stdout=String(source.stdout||''),stderr=String(source.stderr||'');
  const baseBytes=jsonBytes(out),headroom=4096;
  let remaining=Math.max(0,maxBytes-baseBytes-headroom);
  const stdoutBytes=Buffer.byteLength(stdout),stderrBytes=Buffer.byteLength(stderr),total=stdoutBytes+stderrBytes;
  let stdoutBudget=0,stderrBudget=0;
  if(total>0){
    stdoutBudget=Math.floor(remaining*(stdoutBytes/total));
    stderrBudget=remaining-stdoutBudget;
    if(status!=='ok'&&stderrBytes>0){
      const floor=Math.min(stderrBytes,Math.min(128*1024,remaining));
      if(stderrBudget<floor){const delta=floor-stderrBudget;stderrBudget+=delta;stdoutBudget=Math.max(0,stdoutBudget-delta);}
    }
  }
  out.stdout=utf8Slice(stdout,stdoutBudget);
  out.stderr=utf8Slice(stderr,stderrBudget);

  while(jsonBytes(out)>maxBytes){
    const stdoutNow=Buffer.byteLength(out.stdout),stderrNow=Buffer.byteLength(out.stderr);
    if(stdoutNow===0&&stderrNow===0)break;
    if(stdoutNow>=stderrNow)out.stdout=utf8Slice(out.stdout,Math.max(0,stdoutNow-4096));
    else out.stderr=utf8Slice(out.stderr,Math.max(0,stderrNow-4096));
  }
  return out;
}

export function compactResultAfter413(result={}){
  return fitResultForDelivery(result,{maxBytes:RESULT_413_RETRY_BUDGET_BYTES,forceCompact:true,mark413:true});
}

export function isCompacted413Result(result){
  return result?.deliveryCompactedAfter413===true;
}
