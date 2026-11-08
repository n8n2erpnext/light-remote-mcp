//! One user-facing Windows product: this Tauri process owns both the main
//! window and the native OS tray. The separate .NET binary is only a hidden,
//! bounded Agent host and short-lived process bridge (never a second Tray).
use std::ffi::{c_void, OsStr};
use std::os::windows::{ffi::OsStrExt, process::CommandExt};
use std::path::PathBuf;
use std::process::{Command,Stdio};
use std::io::Read;
use std::time::Instant;
use std::thread;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{Manager, menu::{Menu, MenuItem, PredefinedMenuItem}, tray::TrayIconBuilder};

static LINK_UI_REQUESTED: AtomicBool = AtomicBool::new(false);

/// An OS-user/session-bound single GUI instance. Later shortcut launches
/// raise the existing (possibly hidden-to-Tray) window and exit immediately.
pub(crate) fn already_running() -> bool {
    type Handle = *mut c_void;
    #[link(name="kernel32")]
    extern "system" {
        fn CreateMutexW(attributes:*const c_void, initial_owner:i32, name:*const u16)->Handle;
        fn GetLastError()->u32;
        fn CloseHandle(handle:Handle)->i32;
    }
    #[link(name="user32")]
    extern "system" {
        fn FindWindowW(class:*const u16,title:*const u16)->Handle;
        fn ShowWindow(window:Handle,command:i32)->i32;
        fn SetForegroundWindow(window:Handle)->i32;
    }
    let name:Vec<u16>=OsStr::new("Local\\LightRemoteDesktopV4UnifiedOwner")
        .encode_wide().chain(std::iter::once(0)).collect();
    let mutex=unsafe{CreateMutexW(std::ptr::null(),0,name.as_ptr())};
    if mutex.is_null(){return false;}
    let existing=unsafe{GetLastError()}==183;
    if existing {
        let title:Vec<u16>=OsStr::new("Light Remote Desktop V4")
            .encode_wide().chain(std::iter::once(0)).collect();
        let window=unsafe{FindWindowW(std::ptr::null(),title.as_ptr())};
        if !window.is_null(){unsafe{ShowWindow(window,9);SetForegroundWindow(window);}}
        unsafe{CloseHandle(mutex);}
    }
    // The initial process owns its mutex handle until process termination.
    existing
}

pub(crate) fn hide_on_close(window:&tauri::Window,event:&tauri::WindowEvent){
    if let tauri::WindowEvent::CloseRequested{api,..}=event{
        api.prevent_close();
        let _=window.hide();
    }
}

fn bridge_exe()->Result<PathBuf,String>{
    // Never accept a path from JS, browser, local HTTP or environment.
    let current=std::env::current_exe().map_err(|_|"desktop_executable_unavailable")?;
    let root=current.parent().and_then(|p|p.parent()).ok_or("installed_agent_unavailable")?;
    let exe=root.join("GptOperator.Client.exe");
    if !exe.is_file(){return Err("installed_agent_unavailable".into());}
    Ok(exe)
}
fn run_native(action:&str)->Result<serde_json::Value,String>{
    const ACTIONS:&[&str]=&["status","preview","link","poll","disconnect","service","restart",
        "update","open-wall","open-account","open-fleet","open-activation"];
    if !ACTIONS.contains(&action){return Err("desktop_action_denied".into());}
    // The .NET bridge is an owned short-lived process. A hung bridge may not
    // stall the tray or accumulate unbounded output. Never kill another PID.
    let mut child=Command::new(bridge_exe()?)
        .args(["--desktop-bridge",action])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|_|"desktop_agent_unavailable")?;
    let deadline=Instant::now()+Duration::from_secs(14);
    let status=loop {
        match child.try_wait(){
            Ok(Some(status))=>break status,
            Ok(None) if Instant::now()<deadline=>thread::sleep(Duration::from_millis(40)),
            _=>{
                let _=child.kill();let _=child.wait();
                return Err("desktop_agent_bridge_timeout".into());
            }
        }
    };
    if !status.success(){return Err("desktop_agent_unavailable".into());}
    let mut out=Vec::with_capacity(1024);
    child.stdout.take().ok_or("desktop_agent_invalid_response")?
        .take(8193).read_to_end(&mut out)
        .map_err(|_|"desktop_agent_invalid_response")?;
    if out.len()>8192{return Err("desktop_agent_response_too_large".into());}
    serde_json::from_slice(&out).map_err(|_|"desktop_agent_invalid_response".into())
}

#[tauri::command]
pub(crate) async fn desktop_native_action(action:String)
    ->Result<serde_json::Value,String>{
    tauri::async_runtime::spawn_blocking(move||run_native(&action))
        .await.map_err(|_|"desktop_agent_unavailable".to_string())?
}

#[tauri::command]
pub(crate) fn desktop_link_ui_intent()->bool{
    LINK_UI_REQUESTED.swap(false,Ordering::AcqRel)
}

fn show_main(app:&tauri::AppHandle){
    if let Some(window)=app.get_webview_window("main"){
        let _=window.show();let _=window.unminimize();let _=window.set_focus();
    }
}

pub(crate) fn attach(app:&mut tauri::App)->tauri::Result<()>{
    let handle=app.handle();
    let header=MenuItem::with_id(handle,"header","Windows PC - Short ID : ------",false,None::<&str>)?;
    let state=MenuItem::with_id(handle,"state","Checking Agent…",false,None::<&str>)?;
    let open=MenuItem::with_id(handle,"open","Open Light Remote",true,None::<&str>)?;
    let wall=MenuItem::with_id(handle,"wall","Open Wall",true,None::<&str>)?;
    let fleet=MenuItem::with_id(handle,"fleet","Open Fleet",false,None::<&str>)?;
    let account=MenuItem::with_id(handle,"account","Manage Account",true,None::<&str>)?;
    let link=MenuItem::with_id(handle,"link","Link / Relink",true,None::<&str>)?;
    let restart=MenuItem::with_id(handle,"restart","Restart",true,None::<&str>)?;
    let service=MenuItem::with_id(handle,"service","Stop",true,None::<&str>)?;
    let update=MenuItem::with_id(handle,"update","Check Update",true,None::<&str>)?;
    let exit=MenuItem::with_id(handle,"exit","Exit",true,None::<&str>)?;
    let sep1=PredefinedMenuItem::separator(handle)?;
    let sep2=PredefinedMenuItem::separator(handle)?;
    let sep3=PredefinedMenuItem::separator(handle)?;
    let menu=Menu::with_items(handle,&[
        &header,&state,&sep1,&open,&wall,&account,&link,&sep2,
        &restart,&service,&update,&sep3,&exit])?;
    let icon=app.default_window_icon().cloned()
        .expect("Light Remote Desktop icon is required for system tray");
    TrayIconBuilder::new()
        .icon(icon).menu(&menu).show_menu_on_left_click(true)
        .tooltip("Light Remote")
        .on_menu_event(|app,event|{
            match event.id().as_ref(){
                "open"=>show_main(app),
                "link"=>{
                    LINK_UI_REQUESTED.store(true,Ordering::Release);
                    show_main(app);
                },
                "exit"=>app.exit(0),
                "wall"|"fleet"|"account"|"restart"|"service"|"update"=>{
                    let name=match event.id().as_ref(){
                        "wall"=>"open-wall","fleet"=>"open-fleet",
                        "account"=>"open-account","restart"=>"restart",
                        "service"=>"service",_=>"update"
                    };
                    std::thread::spawn(move||{let _=run_native(name);});
                },
                _=>{}
            }
        })
        .build(app)?;
    // Signed metadata is never assembled from a hostname or a local Main
    // guess. The bounded .NET bridge obtains the existing Agent's signed
    // Operator status. Without it, Fleet is removed and Short ID is unknown.
    let menu=menu.clone();
    std::thread::spawn(move||{
        let mut fleet_visible=false;
        loop{
            let data=run_native("status").ok();
            let ok=data.as_ref().and_then(|v|v.get("ok")).and_then(|v|v.as_bool())==Some(true);
            let short=if ok {data.as_ref().and_then(|v|v.get("ShortId")).and_then(|v|v.as_str())} else {None};
            let short=short.filter(|v|v.len()==6).unwrap_or("------");
            let hostname=std::env::var("COMPUTERNAME").unwrap_or_else(|_|"Windows PC".into());
            let _=header.set_text(format!("{hostname} - Short ID : {short}"));
            let connected=ok&&data.as_ref().and_then(|v|v.get("connected")).and_then(|v|v.as_bool())==Some(true);
            let pending=ok&&data.as_ref().and_then(|v|v.get("pending")).and_then(|v|v.as_bool())==Some(true);
            let online=data.as_ref().and_then(|v|v.get("wallOnline")).and_then(|v|v.as_bool())==Some(true);
            let label=if !ok{"Agent unavailable"}else if pending{"Waiting for account approval"}
                else if connected{"Connected"}else if !online{"Stopped"}else{"Cloud dormant / disconnected"};
            let _=state.set_text(label);
            let _=service.set_text(if online{"Stop"}else{"Start"});
            let ready=data.as_ref().and_then(|v|v.get("PendingUpdates")).and_then(|v|v.as_u64())==Some(1);
            let _=update.set_text(if ready{"Check Update (1)"}else{"Check Update"});
            let is_main=ok&&data.as_ref().and_then(|v|v.get("IsMain")).and_then(|v|v.as_bool())==Some(true);
            if is_main!=fleet_visible{
                let changed=if is_main{menu.insert(&fleet,5)}else{menu.remove(&fleet)};
                if changed.is_ok(){fleet_visible=is_main;}
            }
            let fleet_ready=is_main&&data.as_ref().and_then(|v|v.get("fleetUrl")).and_then(|v|v.as_str()).is_some();
            let _=fleet.set_enabled(fleet_ready);
            std::thread::sleep(Duration::from_secs(5));
        }
    });
    Ok(())
}
