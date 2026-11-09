import React, {useCallback,useEffect,useRef,useState} from 'react';
import {FeatureScreen} from './FeatureScreens';
import {WorkspaceShell,type WorkspaceStatus} from './WorkspaceShell';
import {Overview,AiAccess,SettingsPage,type ThemePreference} from './WorkspaceViews';
export {NativeApprovalRequest} from './WorkspaceViews';
import {DeviceLinkDialog,nativeLinkAvailable,pollNativeLinkIntent} from './DeviceLinkDialog';
import {Button} from './components/ui/button';
import {parseRoute,routeHref,type RouteKey} from './lib/routes';
import {readLocalWallStatus,projectLocalStatus,type SnapshotResult} from './lib/status';
import {useNativeDevice} from './lib/native-device';
import {nativeOpenWallAvailable,openLocalWall,type WallView} from './lib/open-wall';
import {probeNativeLocalWall,type NativeWallProbe} from './lib/native-wall-probe';
import {AuthEntry} from './AuthEntry';
import {nativeOwnerAvailable,nativeOwnerBegin,nativeOwnerStatus,nativeOwnerRestore,nativeOwnerLogout,type NativeOwnerView} from './lib/native-owner';
import {nativeWallSsoCandidateAvailable,nativeApproveWallCode} from './lib/native-wall-sso';
import {nativeAbv2Available,nativeAbv2Pending,nativeAbv2Approve,type NativeAbv2Status,type NativeAbv2Request} from './lib/native-abv2';
import {nativeOwnerSnapshotAvailable,nativeOwnerSnapshot,type SnapshotView} from './lib/native-snapshot';
import {startScopedReadPoller,type ScopedReadPoller} from './lib/scoped-read-poller';
type LoadState=WorkspaceStatus;

const UI_DESIGN_PREVIEW = import.meta.env.MODE === 'test' || import.meta.env.VITE_LR_V4_UI_TEST === '1';
const NATIVE_OWNER_CANDIDATE = import.meta.env.VITE_LR_V4_OWNER_LOGIN === '1' && !UI_DESIGN_PREVIEW;

function initialTheme(): ThemePreference {
  try {
    const saved = window.localStorage.getItem('lr-v4-theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch { /* storage unavailable is not an error */ }
  return 'system';
}

function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    function apply() {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    }
    apply();
    media.addEventListener?.('change', apply);
    return () => media.removeEventListener?.('change', apply);
  }, [theme]);
  const choose = useCallback((mode: ThemePreference) => {
    setTheme(mode);
    try { window.localStorage.setItem('lr-v4-theme', mode); } catch { /* ignore */ }
  }, []);
  return { theme, choose };
}

export function App() {
  const [route, setRoute] = useState<RouteKey>(() => parseRoute(window.location.hash));
  const [showDeviceLink,setShowDeviceLink]=useState(false);
  const closeDeviceLink=useCallback(()=>setShowDeviceLink(false),[]);
  useEffect(()=>{
    if(!nativeLinkAvailable())return;
    let live=true;
    const id=window.setInterval(()=>{
      void pollNativeLinkIntent().then(requested=>{if(live&&requested)setShowDeviceLink(true);});
    },850);
    return()=>{live=false;window.clearInterval(id);};
  },[]);
  const [inDesignPreview, setInDesignPreview] = useState(false);
  const [nativeOwner, setNativeOwner] = useState<NativeOwnerView>({phase:'unavailable',accountId:null});
  const { theme, choose } = useTheme();
  const nativeLoginAvailable = NATIVE_OWNER_CANDIDATE && nativeOwnerAvailable();
  const nativeOwnerVerified = nativeLoginAvailable && nativeOwner.phase === 'verified';
  const localDevice=useNativeDevice('device.read',nativeOwnerVerified?nativeOwner.accountId:null);
  const nativeAbv2Pilot=!UI_DESIGN_PREVIEW&&nativeOwnerVerified&&nativeAbv2Available();
  const [abv2,setAbv2]=useState<NativeAbv2Status>({state:'unavailable',reason:'not_checked'});
  const [abv2Scope,setAbv2Scope]=useState<string|null>(null);
  const scopedAbv2=nativeAbv2Pilot&&abv2Scope===nativeOwner.accountId?abv2:null;
  const [ownerData,setOwnerData]=useState<SnapshotView>({state:'unavailable',reason:'not_checked'});
  const ownerDataPoller=useRef<ScopedReadPoller|null>(null);
  const snapshot=ownerData.state==='ready' && nativeOwnerVerified &&
    ownerData.accountId===nativeOwner.accountId?ownerData:null;
  useEffect(()=>{
    if(!nativeOwnerVerified||!nativeOwner.accountId||!nativeOwnerSnapshotAvailable()){
      setOwnerData({state:'unavailable',reason:'owner_api_unavailable'});
      return;
    }
    const accountId=nativeOwner.accountId;
    setOwnerData({state:'unavailable',reason:'owner_snapshot_refreshing'});
    const poller=startScopedReadPoller({
      intervalMs:20_000,
      task:()=>nativeOwnerSnapshot(accountId),
      apply:setOwnerData,
      healthy:(view)=>view.state==='ready',
      unavailable:():SnapshotView=>({state:'unavailable',reason:'owner_api_unavailable'})
    });
    ownerDataPoller.current=poller;
    return ()=>{poller.stop();if(ownerDataPoller.current===poller)ownerDataPoller.current=null;};
  },[nativeOwnerVerified,nativeOwner.accountId]);
  const [abv2Approving,setAbv2Approving]=useState(false);
  useEffect(()=>{
    const changed=(event:Event)=>{
      if((event as CustomEvent<{accountId:string}>).detail?.accountId===nativeOwner.accountId)
        ownerDataPoller.current?.refreshNow();
    };
    document.addEventListener('lightremote:device-change',changed);
    return()=>document.removeEventListener('lightremote:device-change',changed);
  },[nativeOwner.accountId]);
  const abv2Poller=useRef<ScopedReadPoller|null>(null);
  const refreshAbv2=useCallback(()=>{
    if(nativeAbv2Pilot)abv2Poller.current?.refreshNow();
  },[nativeAbv2Pilot]);
  const approveAbv2=async(request:NativeAbv2Request,bCode:string,consentCode:string)=>{
    if(!nativeAbv2Pilot||abv2Scope!==nativeOwner.accountId||abv2Approving)return false;
    setAbv2Approving(true);
    try{
      const result=await nativeAbv2Approve(request,bCode,consentCode);
      if(result.state==='granted')refreshAbv2();
      return result.state==='granted';
    }finally{setAbv2Approving(false);}
  };
  useEffect(()=>{
    if(!nativeAbv2Pilot){
      setAbv2({state:'unavailable',reason:'owner_not_verified'});setAbv2Scope(null);
      return;
    }
    const accountId=nativeOwner.accountId;
    const poller=startScopedReadPoller({
      intervalMs:8000,
      task:nativeAbv2Pending,
      apply:value=>{setAbv2(value);setAbv2Scope(accountId);},
      healthy:(view)=>view.state==='ready',
      unavailable:():NativeAbv2Status=>({state:'unavailable',reason:'agent_or_owner_unavailable'})
    });
    abv2Poller.current=poller;
    return ()=>{
      if(abv2Poller.current===poller)abv2Poller.current=null;
      poller.stop();
    };
  },[nativeAbv2Pilot,nativeOwner.accountId]);

  const nativeWallSsoPilot = !UI_DESIGN_PREVIEW && nativeWallSsoCandidateAvailable();
  const [wallSsoCode,setWallSsoCode]=useState('');
  const [wallSsoBusy,setWallSsoBusy]=useState(false);
  const [wallSsoResult,setWallSsoResult]=useState<string|null>(null);
  const approveBrowserWallCode=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!nativeOwnerVerified||!nativeWallSsoPilot||wallSsoBusy)return;
    setWallSsoBusy(true);setWallSsoResult(null);
    const approved=await nativeApproveWallCode(wallSsoCode);
    setWallSsoBusy(false);setWallSsoCode('');
    setWallSsoResult(approved
      ?'Confirmed. Return to your browser to finish signing in.'
      :'We could not confirm this code. Check your Wall request and try again.');
  };
  const workspaceUnlocked = inDesignPreview || nativeOwnerVerified;
  const [status, setStatus] = useState<LoadState>({ phase: 'loading', result: null });
  const [reload, setReload] = useState(0);
  const [wallProbe, setWallProbe] = useState<NativeWallProbe>('unavailable');
  const [wallOpenError, setWallOpenError] = useState<string | null>(null);
  const canOpenWall = nativeOpenWallAvailable();
  const requestOpenWall = useCallback((view: WallView) => {
    setWallOpenError(null);
    void openLocalWall(view).then(result => {
      if (result.state === 'unavailable') setWallOpenError('Could not launch the system browser. Check that the default browser is available.');
    });
  }, []);

  // Native Rust owns PKCE, the vault and server verification; never JS tokens.
  useEffect(() => {
    if (!nativeLoginAvailable) return;
    let alive=true;
    let sequence=0;
    const apply=(view:NativeOwnerView,rev:number)=>{
      if(alive && rev===sequence)setNativeOwner(view);
    };
    const poll=()=>{
      const rev=++sequence;
      void nativeOwnerStatus().then(view=>apply(view,rev));
    };
    const rev=++sequence;
    void nativeOwnerRestore().then(view=>apply(view,rev));
    const timer=window.setInterval(poll,3_000);
    const onVisible=()=>{if(!document.hidden)poll();};
    document.addEventListener('visibilitychange',onVisible);
    return ()=>{
      alive=false;window.clearInterval(timer);
      document.removeEventListener('visibilitychange',onVisible);
    };
  },[nativeLoginAvailable]);

  const beginNativeOwner=()=>{
    if(nativeLoginAvailable)void nativeOwnerBegin().then(setNativeOwner);
  };
  const cancelNativeOwner=()=>{
    if(nativeLoginAvailable)void nativeOwnerLogout().then(setNativeOwner);
  };

  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  useEffect(() => {
    if (!workspaceUnlocked) {
      setStatus({ phase: 'settled', result: null });
      return;
    }
    if(nativeOwnerVerified)return;
    const controller = new AbortController();
    let live = true;
    setStatus({ phase: 'loading', result: null });
    void readLocalWallStatus(fetch, controller.signal).then(result => {
      if (live) setStatus({ phase: 'settled', result });
    });
    return () => { live = false; controller.abort(); };
  }, [reload, workspaceUnlocked,nativeOwnerVerified]);

  useEffect(() => {
    if (!workspaceUnlocked || !nativeOpenWallAvailable()) return;
    let live = true;
    setWallProbe('unavailable');
    void probeNativeLocalWall().then(result => { if (live) setWallProbe(result); });
    return () => { live = false; };
  }, [reload, workspaceUnlocked]);

  // A previously verified connection must not remain shown forever.
  // Poll read-only status while visible and revalidate immediately after returning.
  useEffect(() => {
    if (!workspaceUnlocked) return;
    const refreshVisible = () => {
      if (!document.hidden) setReload(value => value + 1);
    };
    const timer = window.setInterval(refreshVisible, 15_000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [workspaceUnlocked]);

  const navigate = (next: RouteKey) => {
    setRoute(next);
    if (window.location.hash !== routeHref(next)) window.location.hash = routeHref(next);
  };

  // Project the current Owner/device synchronously; an account change must
  // never paint one frame of the previous account's device state.
  const displayStatus:LoadState=nativeOwnerVerified?{
    phase:localDevice.reason==='not_checked'?'loading':'settled',
    result:localDevice.view?.device?projectLocalStatus({ok:true,local:localDevice.view.device},localDevice.view.asOf??Date.now()):
      {state:'unavailable',reason:localDevice.reason||'desktop_device_unavailable'}
  }:status;

  // Enforce authentication as the ENTRY route. Neither location.hash nor
  // native localhost probe can skip this gate. Only explicit UI-test builds
  // expose a non-authoritative preview; no credential is persisted.
  if (!workspaceUnlocked) {
    // Enrollment is a local physical-device action, not an Agent grant.
    // The Owner has to be able to open the Tray Link dialog even BEFORE
    // Desktop OAuth login; no JS bearer or saved login is accessed here.
    return <>
      <AuthEntry
        allowDesignPreview={UI_DESIGN_PREVIEW}
        onPreviewWorkspace={() => { if (UI_DESIGN_PREVIEW) setInDesignPreview(true); }}
        nativePhase={nativeLoginAvailable ? nativeOwner.phase : undefined}
        onBrowserSignIn={nativeLoginAvailable ? beginNativeOwner : undefined}
        onCancelSignIn={nativeLoginAvailable ? cancelNativeOwner : undefined}
        onLinkDevice={nativeLinkAvailable()?()=>setShowDeviceLink(true):undefined} />
      {showDeviceLink&&nativeLinkAvailable()&&<DeviceLinkDialog onClose={closeDeviceLink}/>}
    </>;
  }

  return (
    <WorkspaceShell route={route} navigate={navigate} status={displayStatus} wallProbe={wallProbe}
      preview={inDesignPreview} accountEmail={snapshot?.account.email}
      canOpenWall={canOpenWall} onOpenWall={()=>requestOpenWall('home')}
      onRefresh={()=>{setReload(i=>i+1);ownerDataPoller.current?.refreshNow();refreshAbv2();document.dispatchEvent(new Event('lightremote:refresh'));}}
      onSignOut={inDesignPreview?()=>setInDesignPreview(false):cancelNativeOwner}
      onLinkDevice={nativeLinkAvailable()?()=>setShowDeviceLink(true):undefined}>
        {wallOpenError && <div className="open-wall-error" role="alert">{wallOpenError}</div>}
        {nativeWallSsoPilot && nativeOwnerVerified && route==='overview' && !inDesignPreview && (
          <section className="owner-wall-sso-review" aria-labelledby="owner-wall-sso-title">
            <h2 id="owner-wall-sso-title">Sign in to Local Wall</h2>
            <p>On this device, open Wall and select <strong>Sign in with Desktop</strong>. Generate a verification code in that browser tab, then enter it here. This never approves Agent A/B access.</p>
            <form onSubmit={approveBrowserWallCode}>
              <label htmlFor="owner-wall-sso-code">Wall verification code</label>
              <input id="owner-wall-sso-code" value={wallSsoCode}
                maxLength={8} autoComplete="off" autoCapitalize="none" spellCheck={false}
                onChange={event=>{setWallSsoCode(event.target.value);setWallSsoResult(null);}}
                aria-describedby="owner-wall-sso-info" />
              <Button type="submit" disabled={wallSsoBusy||!(/^[A-Za-z0-9_-]{8}$/.test(wallSsoCode))}>
                {wallSsoBusy?'Checking code…':'Approve Wall sign-in'}
              </Button>
            </form>
            <p id="owner-wall-sso-info">The code expires after 60 seconds. Return to the same browser tab to finish signing in.</p>
            {wallSsoResult && <p role="status">{wallSsoResult}</p>}
          </section>
        )}
        {route === 'overview' ? <Overview status={displayStatus} navigate={navigate} wallProbe={wallProbe} abv2={scopedAbv2} snapshot={snapshot} />
          : route === 'ai-access' ? <AiAccess key={nativeOwner.accountId||'signed-out'} status={displayStatus} native={scopedAbv2} snapshot={snapshot} ownerAccountId={nativeOwnerVerified?nativeOwner.accountId:null} refresh={refreshAbv2} approving={abv2Approving} onApprove={approveAbv2} />
            : route === 'settings' ? <SettingsPage key={nativeOwner.accountId||'signed-out'} theme={theme} choose={choose} status={displayStatus} openWall={requestOpenWall} canOpenWall={canOpenWall} accountId={nativeOwnerVerified?nativeOwner.accountId:null} />
              : <FeatureScreen route={route} status={displayStatus.result} snapshot={snapshot} ownerAccountId={nativeOwnerVerified?nativeOwner.accountId:null} localDeviceId={localDevice.reply?.deviceId} onLinkDevice={nativeLinkAvailable()?()=>setShowDeviceLink(true):undefined} />}
      {showDeviceLink&&nativeLinkAvailable()&&<DeviceLinkDialog onClose={closeDeviceLink} />}
    </WorkspaceShell>
  );
}
