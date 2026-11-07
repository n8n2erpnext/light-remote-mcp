import {useEffect, useRef, useState} from 'react';
import {Button} from './components/ui/button';

type Reply = Record<string,unknown>;
type LocalLink = {state:'pending'|'expired'|'none';code:string|null;expiresAt:number};
type LinkStatus = {enrolled:boolean;connected:boolean;shortId:string|null};

function rec(v:unknown):Reply {
  return v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Reply:{};
}
type Host=Window & {__TAURI_INTERNALS__?:{invoke?:(command:string,args?:Record<string,unknown>)=>Promise<unknown>}};
export function nativeLinkAvailable(host:Window=window):boolean {
  // The native Link command is registered ONLY in Windows Tauri. A compile-
  // time Windows target marker avoids a broken Link UI on macOS/Linux Owner.
  return import.meta.env.VITE_LR_V4_OWNER_LOGIN==='1' &&
    import.meta.env.VITE_LR_V4_NATIVE_WINDOWS==='1' &&
    typeof (host as Host).__TAURI_INTERNALS__?.invoke==='function';
}
async function invoke(action:string):Promise<Reply> {
  if(!nativeLinkAvailable())return {ok:false,state:'native_unavailable'};
  try {return rec(await (window as Host).__TAURI_INTERNALS__!.invoke!('desktop_native_action',{action}));}
  catch{return {ok:false,state:'agent_unavailable'};}
}
export async function pollNativeLinkIntent():Promise<boolean> {
  if(!nativeLinkAvailable())return false;
  try{return (await (window as Host).__TAURI_INTERNALS__!.invoke!('desktop_link_ui_intent'))===true;}
  catch{return false;}
}
function linkFrom(raw:Reply):LocalLink {
  const ms=Number(raw.expiresAt);
  const code=typeof raw.deviceCode==='string'&&/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(raw.deviceCode)
    ?raw.deviceCode:null;
  if(raw.ok===true&&raw.state==='pending'&&Number.isFinite(ms)&&ms>Date.now()&&code)
    return {state:'pending',code,expiresAt:ms};
  return {state:raw.state==='expired'?'expired':'none',code:null,expiresAt:0};
}
function statusFrom(raw:Reply):LinkStatus {
  return {enrolled:raw.Enrolled===true,connected:raw.connected===true,
    shortId:typeof raw.ShortId==='string'&&/^[0-9A-HJKMNP-TV-Z]{6}$/.test(raw.ShortId)
      ?raw.ShortId:null};
}
export function DeviceLinkDialog({onClose}:{onClose:()=>void}){
  const [link,setLink]=useState<LocalLink>({state:'none',code:null,expiresAt:0});
  const [device,setDevice]=useState<LinkStatus>({enrolled:false,connected:false,shortId:null});
  const [busy,setBusy]=useState(false);
  const [ready,setReady]=useState(false);
  const [confirmRelink,setConfirmRelink]=useState(false);
  const [message,setMessage]=useState('');
  const [now,setNow]=useState(Date.now());
  const pollBusy=useRef(false);
  // Parent snapshots/polling rerender often: onClose identity must never restart
  // native status/preview requests and erase the currently visible device code.
  const onCloseRef=useRef(onClose);onCloseRef.current=onClose;
  useEffect(()=>{
    let active=true;
    void Promise.all([invoke('status'),invoke('preview')]).then(([s,p])=>{
      if(!active)return;
      setDevice(statusFrom(s));setLink(linkFrom(p));setReady(true);
      if(s.ok!==true)setMessage('Device Agent is unavailable. Check Local Wall and try again.');
    });
    const clock=window.setInterval(()=>setNow(Date.now()),1000);
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onCloseRef.current();};
    window.addEventListener('keydown',onKey);
    return()=>{active=false;window.clearInterval(clock);window.removeEventListener('keydown',onKey);};
  },[]);
  const remaining=Math.max(0,Math.ceil((link.expiresAt-now)/1000));
  useEffect(()=>{
    if(link.state!=='pending')return;
    let active=true;
    const check=async()=>{
      if(pollBusy.current)return;
      pollBusy.current=true;
      try{
        const result=await invoke('poll');
        if(!active)return;
        if(result.state==='approved'||result.state==='approved_connect_required'||
           result.state==='approved_restart_required'){
          setLink({state:'none',code:null,expiresAt:0});
          setMessage(result.state==='approved'?'Device linked. Agent is reconnecting.':
            'Device approved. Check Agent connection/restart status.');
          setDevice(statusFrom(await invoke('status')));
        } else if(['expired','replaced','cancelled'].includes(String(result.state))){
          setLink({state:'expired',code:null,expiresAt:0});
          setMessage('The one-time code expired. You can request a new code now.');
        }
      } finally {pollBusy.current=false;}
    };
    const timer=window.setInterval(()=>{void check();},4000);
    if(remaining<=0)void check();
    return()=>{active=false;window.clearInterval(timer);};
  },[link.state,link.expiresAt,remaining<=0]);
  const begin=async()=>{
    if(busy)return;
    setBusy(true);setMessage('');
    const answer=await invoke('link');
    if(answer.state==='disconnect_required'){
      setDevice(x=>({...x,connected:true}));
      setMessage('Disconnect the active Cloud session before relinking. Existing Agent access is never transferred silently.');
    }else{
      const next=linkFrom(answer);
      if(next.state==='pending'){setLink(next);setConfirmRelink(false);}
      else if(next.state==='expired'){setLink(next);setMessage('Previous approval expired. Retry Link / Relink.');}
      else setMessage('Unable to create a device code. Check the installed Agent.');
    }
    setBusy(false);
  };
  const disconnect=async()=>{
    if(busy)return;
    setBusy(true);
    const result=await invoke('disconnect');
    if(result.ok===true){
      setDevice(x=>({...x,connected:false}));
      setMessage('Cloud disconnected. The device may now be relinked without transferring sessions.');
    } else setMessage('Could not disconnect the current session. Check Local Wall.');
    setBusy(false);
  };
  const copy=async()=>{
    if(!link.code)return;
    try{await navigator.clipboard.writeText(link.code);setMessage('Code copied.');}
    catch{
      const element=document.getElementById('device-link-code') as HTMLInputElement|null;
      element?.select();element?.focus();
      setMessage('Select the code and press Ctrl+C to copy it.');
    }
  };
  const open=async()=>{
    const result=await invoke('open-activation');
    if(result.ok!==true)setMessage('Approval page unavailable. Check the code expiration and try again.');
  };
  const fmt=(n:number)=>String(n).padStart(2,'0');
  return <div className="device-link-backdrop">
    <section className="device-link-modal" role="dialog" aria-modal="true" aria-labelledby="device-link-title">
      <div className="device-link-heading">
        <div><h2 id="device-link-title">Link / Relink this Windows PC</h2>
          <p>One Light Remote app · current device only</p></div>
        <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
      </div>
      <p className="device-link-note">
        {device.shortId?'Short ID: '+device.shortId+' · ':''}
        Link this device to your Owner account. Agent permissions still require separate Local Wall A/B approval.
      </p>
      {!ready?<p role="status">Checking the local device enrollment…</p>
      :link.state==='pending'&&remaining>0?<>
        <label htmlFor="device-link-code">One-time device code (selectable)</label>
        <div className="device-link-code-row">
          <input id="device-link-code" value={link.code||''} type="text" readOnly
            spellCheck={false} onFocus={e=>e.currentTarget.select()} aria-label="Device code" />
          <Button type="button" onClick={()=>{void copy();}}>Copy code</Button>
        </div>
        <p className="device-link-expiry" role="timer">
          Expires in {fmt(Math.floor(remaining/60))}:{fmt(remaining%60)} · Waiting for account approval
        </p>
        <Button type="button" variant="primary" onClick={()=>{void open();}}>Open approval page</Button>
        <p className="device-link-note">Closing this window does not discard the code. Open Link / Relink again from Tray to recover it.</p>
      </>:device.connected?<>
        <p role="status">This PC is currently connected to Cloud. Relink requires an intentional disconnect first.</p>
        <Button type="button" variant="secondary" disabled={busy} onClick={()=>{void disconnect();}}>
          Disconnect Cloud before relink
        </Button>
      </>:<>
        <p>{device.enrolled?'This PC already has an enrollment. Its identity and local settings will be preserved until a new account approves the relink.':
          'Request a new code to link this Windows PC to your Light Remote account.'}</p>
        {device.enrolled&&!confirmRelink?(
          <Button type="button" disabled={busy} onClick={()=>setConfirmRelink(true)}>Review relink</Button>
        ):(
          <Button type="button" variant="primary" disabled={busy} onClick={()=>{void begin();}}>
            {busy?'Preparing…':device.enrolled?'Confirm relink':'Get device code'}
          </Button>
        )}
      </>}
      {message&&<p className="device-link-status" role="status">{message}</p>}
    </section>
  </div>;
}
