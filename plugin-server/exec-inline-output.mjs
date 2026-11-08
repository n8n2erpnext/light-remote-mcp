// Gold opt-in, bounded fast-path to avoid a second MCP turn for small exec stdout.
// Never change default legacy exec semantics; no inline stderr or log flooding.
export async function maybeInlineExecStdout(view,adapter,{inlineStdout=false,maxBytes=1536}={}){
  const commandFailed=view?.ok===false &&
    view.error==='command_exit_nonzero' &&
    view.executionCompleted===true &&
    view.commandSucceeded===false &&
    view.job?.state==='error' &&
    Number.isInteger(view.job?.exitCode) && view.job.exitCode>0;
  const commandSucceeded=view?.ok===true && view.job?.state==='ok' &&
    view.job?.exitCode===0;
  if(!inlineStdout || !view?.job || view.job.running!==false ||
    (!commandSucceeded&&!commandFailed))return view;
  const cap=Math.max(64,Math.min(2048,Number(maxBytes)||1536));
  if(commandFailed){
    // Return both streams for small failed commands, and preserve the same
    // canonical scoped output access for longer / not-yet-persisted receipts.
    // Never treat an execution failure as commandSucceeded.
    const readStream=async stream=>{
      try{
        const r=await adapter.output(view.job.jobId,stream,0,cap,false);
        const out=String(r?.output||''),len=Buffer.byteLength(out,'utf8');
        if(r?.hasMore===true||Number(r?.totalBytes)>cap||len>cap)
          return {complete:false,totalBytes:Number(r?.totalBytes)||null,
            reason:'use_light_remote_output'};
        return {complete:true,output:out,totalBytes:len};
      }catch{return {complete:false,reason:'use_light_remote_output'};}
    };
    const [inlineStdout,inlineStderr]=await Promise.all([
      readStream('stdout'),readStream('stderr')]);
    return {...view,inlineStdout,inlineStderr};
  }
  try {
    // AccountOperatorAdapter.output performs canonical ownership/device checks
    // and redacts restricted text. Never read job data via unscoped URLs.
    const result=await adapter.output(view.job.jobId,'stdout',0,cap,false);
    const len=Buffer.byteLength(String(result?.output||''),'utf8');
    if(result?.hasMore===true || Number(result?.totalBytes)>cap || len>cap)
      return {...view,inlineStdout:{complete:false,totalBytes:Number(result?.totalBytes)||null,reason:'use_light_remote_output'}};
    return {...view,inlineStdout:{complete:true,output:String(result?.output||''),totalBytes:len}};
  }catch{
    // Output not yet persisted or read unavailable: job remains valid and
    // recoverable using its unchanged jobId via light_remote_output.
    return {...view,inlineStdout:{complete:false,reason:'use_light_remote_output'}};
  }
}
