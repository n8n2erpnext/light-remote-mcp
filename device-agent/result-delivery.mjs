export function compactResultAfter413(result={}){
  const source=result&&typeof result==='object'?result:{},originalBytes=Buffer.byteLength(JSON.stringify(source));
  const telemetry=source.telemetry&&typeof source.telemetry==='object'?{...source.telemetry}:undefined;
  return {
    commandId:String(source.commandId||''),
    status:'error',
    exitCode:1,
    stdout:'',
    stderr:`device_result_payload_too_large:${originalBytes}\n`,
    durationMs:Math.max(0,Number(source.durationMs)||0),
    outputTruncated:true,
    data:{ok:false,error:'device_result_payload_too_large',status:413,originalBytes},
    ...(telemetry?{telemetry}:{})
  };
}
export function isCompacted413Result(result){
  return result?.data?.error==='device_result_payload_too_large'&&Number(result?.data?.status)===413;
}
