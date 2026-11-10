export const WALL_PTY_READER_SCRIPT=String.raw`
let ptyPlainText='';
const ptyReadStatus=document.createElement('p');ptyReadStatus.className='pty-read-status muted';ptyReadStatus.setAttribute('role','status');
const ptyTranscript=document.createElement('details');ptyTranscript.className='pty-transcript';
const ptySummary=document.createElement('summary');ptySummary.textContent='Text transcript';
const ptyText=document.createElement('textarea');ptyText.readOnly=true;ptyText.spellcheck=false;ptyText.setAttribute('aria-label','Read-only terminal text transcript');
const ptyCopy=document.createElement('button');ptyCopy.type='button';ptyCopy.className='btn small';ptyCopy.textContent='Copy transcript';ptyCopy.onclick=()=>copyText(ptyText.value,'Terminal transcript copied');
ptyTranscript.append(ptySummary,ptyText,ptyCopy);ptyOutput.append(ptyReadStatus,ptyTranscript);
function ptyPlain(value){return String(value||'').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\x1b[@-_]/g,'').replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');}
function ptyResetOutput(){ptyPlainText='';ptyText.value='';ptyReadStatus.textContent='Waiting for terminal output…';}
function ptyMatchGrid(){
 if(!ptyTerm||!ptyActive)return;
 const cols=Math.max(20,Math.min(500,Number(ptyActive.cols)||120)),rows=Math.max(5,Math.min(200,Number(ptyActive.rows)||32));
 // Keep the producer's grid: fitting the observer to a narrower widget
 // corrupts cursor-addressed ConPTY/full-screen output.
 if(ptyTerm.cols!==cols||ptyTerm.rows!==rows)ptyTerm.resize(cols,rows);
}
async function ptyPaintOutput(out,term,isCurrent){
 if(!isCurrent())return false;
 const text=typeof out.text==='string'?out.text:'';
 if(text){ptyPlainText=(ptyPlainText+ptyPlain(text)).slice(-131072);ptyText.value=ptyPlainText;}
 if(term&&text){
  ptyMatchGrid();
  await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();};const timer=setTimeout(()=>{ptyTranscript.open=true;finish();},1500);try{term.write(text,finish);}catch{ptyTranscript.open=true;finish();}});
 }else if(!term)ptyTranscript.open=true;
 if(!isCurrent())return false;
 ptyReadStatus.textContent=ptyPlainText.trim()?'Live read-only output · text transcript is available':Number(out.totalBytes)>0?'Connected · the shell has sent control data; waiting for printable output.':'Connected · waiting for the shell to produce output.';
 return true;
}
if(document.fonts?.ready)void document.fonts.ready.then(()=>{ptyMatchGrid();ptyTerm?.refresh(0,Math.max(0,ptyTerm.rows-1));});
`;
