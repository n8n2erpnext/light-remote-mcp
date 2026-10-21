// Gold opt-in, bounded fast-path to avoid a second MCP turn for small exec stdout.
// Never change default legacy exec semantics; no inline stderr or log flooding.
export async function maybeInlineExecStdout(view,adapter,{inlineStdout=false,maxBytes=1536}={}){
  if(!inlineStdout || view?.ok!==true || !view.job || view.job.running!==false ||
     view.job.state!=='ok' || view.job.exitCode!==0) return view;
  const cap=Math.max(64,Math.min(2048,Number(maxBytes)||1536));
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
