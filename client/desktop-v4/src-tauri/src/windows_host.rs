//! Fixed-path in-process .NET component hosting for the Windows product.
//! Only the OS CLI can dispatch worker roles. Renderer/tray calls remain a
//! twelve-action allowlist; no assembly path, method, URL or token crosses IPC.
use std::{ffi::{c_char,c_void,CStr,OsStr},os::windows::ffi::OsStrExt,path::PathBuf,sync::OnceLock};

type Handle = *mut c_void;
type Init = unsafe extern "C" fn(*const u16,*const InitParameters,*mut Handle)->i32;
type GetDelegate = unsafe extern "C" fn(Handle,i32,*mut Handle)->i32;
type SetProperty = unsafe extern "C" fn(Handle,*const u16,*const u16)->i32;
type Close = unsafe extern "C" fn(Handle)->i32;
type LoadAssembly = unsafe extern "system" fn(*const u16,*const u16,*const u16,*const u16,Handle,*mut Handle)->i32;
type Run = unsafe extern "C" fn(*const u8,i32,*mut Handle)->i32;
type Free = unsafe extern "C" fn(Handle);

#[repr(C)]
struct InitParameters { size:usize,host_path:*const u16,dotnet_root:*const u16 }
#[link(name="kernel32")]
extern "system" {
    fn LoadLibraryExW(file:*const u16,reserved:Handle,flags:u32)->Handle;
    fn GetProcAddress(module:Handle,name:*const u8)->Handle;
}

struct Api { run:Run,free:Free,_library:usize }
static API:OnceLock<Result<Api,String>>=OnceLock::new();

fn wide(value:impl AsRef<OsStr>)->Vec<u16>{value.as_ref().encode_wide().chain(Some(0)).collect()}
pub(crate) fn install_root()->Result<PathBuf,String>{
    let exe=std::env::current_exe().map_err(|_|"native_core_path_unavailable")?;
    let parent=exe.parent().ok_or("native_core_path_unavailable")?;
    let legacy=exe.file_name().and_then(|n|n.to_str()).map(|n|n.eq_ignore_ascii_case("LightRemote.Desktop.exe")).unwrap_or(false)
        && parent.file_name().and_then(|n|n.to_str()).map(|n|n.eq_ignore_ascii_case("desktop-v4")).unwrap_or(false);
    Ok(if legacy{parent.parent().ok_or("native_core_path_unavailable")?.to_path_buf()}else{parent.to_path_buf()})
}
pub(crate) fn required()->bool{
    std::env::current_exe().ok()
        .and_then(|path|path.file_name().map(|name|name.to_string_lossy().eq_ignore_ascii_case("LightRemote.exe")))
        .unwrap_or(false)
}
pub(crate) fn available()->bool{
    install_root().map(|p|p.join("windows-host/LightRemote.WindowsHost.dll").is_file()).unwrap_or(false)
}

fn load()->Result<Api,String>{
    let root=install_root()?;
    let component=root.join("windows-host");
    let runtime=component.join("runtime");
    let library=component.join("LightRemote.WindowsHost.dll");
    let config=component.join("LightRemote.WindowsHost.runtimeconfig.json");
    let fxr=component.join("hostfxr.dll");
    if !library.is_file()||!config.is_file()||!fxr.is_file()||!runtime.is_dir(){
        return Err("native_host_component_missing".into());
    }
    // The framework-dependent managed library resolves ONLY against the
    // private packaged frameworks. No global dotnet.exe or apphost is run.
    let library_handle=unsafe{LoadLibraryExW(wide(&fxr).as_ptr(),std::ptr::null_mut(),0x00000100|0x00000800)};
    if library_handle.is_null(){return Err("native_host_runtime_load_failed".into());}
    macro_rules! export {
        ($name:literal,$kind:ty)=>{{
            let address=unsafe{GetProcAddress(library_handle,concat!($name,"\0").as_ptr())};
            if address.is_null(){return Err(concat!("native_host_export_missing:",$name).into());}
            unsafe{std::mem::transmute::<Handle,$kind>(address)}
        }};
    }
    let initialize=export!("hostfxr_initialize_for_runtime_config",Init);
    let delegate=export!("hostfxr_get_runtime_delegate",GetDelegate);
    let set_property=export!("hostfxr_set_runtime_property_value",SetProperty);
    let close=export!("hostfxr_close",Close);
    let exe=wide(std::env::current_exe().map_err(|_|"native_core_path_unavailable")?);
    let runtime=wide(runtime);
    let parameters=InitParameters{size:std::mem::size_of::<InitParameters>(),host_path:exe.as_ptr(),dotnet_root:runtime.as_ptr()};
    let mut context=std::ptr::null_mut();
    let status=unsafe{initialize(wide(config).as_ptr(),&parameters,&mut context)};
    if status<0||context.is_null(){return Err(format!("native_host_runtime_initialize_{:08x}",status as u32));}
    let result:Result<Api,String>=(||{
        for (name,value) in [("APP_CONTEXT_BASE_DIRECTORY",root.as_os_str()),("STARTUP_HOOKS",OsStr::new(""))]{
            let status=unsafe{set_property(context,wide(name).as_ptr(),wide(value).as_ptr())};
            if status<0{return Err("native_host_runtime_properties_failed".into());}
        }
        let mut loader=std::ptr::null_mut();
        // hdt_load_assembly_and_get_function_pointer, defined by hostfxr.h.
        let status=unsafe{delegate(context,5,&mut loader)};
        if status<0||loader.is_null(){return Err("native_host_component_delegate_failed".into());}
        let loader:LoadAssembly=unsafe{std::mem::transmute(loader)};
        let assembly=wide(library);
        let typename=wide("GptOperator.Client.EmbeddedHostExports, LightRemote.WindowsHost");
        let find=|method:&str|->Result<Handle,String>{
            let mut address=std::ptr::null_mut();
            // UNMANAGEDCALLERSONLY_METHOD from coreclr_delegates.h.
            let status=unsafe{loader(assembly.as_ptr(),typename.as_ptr(),wide(method).as_ptr(),usize::MAX as *const u16,std::ptr::null_mut(),&mut address)};
            if status<0||address.is_null(){return Err(format!("native_host_method_unavailable:{method}"));}
            Ok(address)
        };
        let run=unsafe{std::mem::transmute::<Handle,Run>(find("Run")?)};
        let free=unsafe{std::mem::transmute::<Handle,Free>(find("Free")?)};
        Ok(Api{run,free,_library:library_handle as usize})
    })();
    unsafe{close(context);}
    // The runtime and delegates live for this native process's lifetime.
    // Closing a hostfxr context does not unload the CLR/component.
    result
}

fn call(args:&[String])->Result<(i32,Option<serde_json::Value>),String>{
    let api=API.get_or_init(load).as_ref().map_err(Clone::clone)?;
    let request=serde_json::to_vec(args).map_err(|_|"native_host_request_invalid")?;
    if request.is_empty()||request.len()>128*1024{return Err("native_host_request_too_large".into());}
    let mut response=std::ptr::null_mut();
    let status=unsafe{(api.run)(request.as_ptr(),request.len() as i32,&mut response)};
    let bytes=if response.is_null(){None}else{
        let value=unsafe{CStr::from_ptr(response as *const c_char)}.to_bytes().to_vec();
        unsafe{(api.free)(response);}
        if value.len()>8192{return Err("native_host_response_too_large".into());}
        Some(value)
    };
    let json:Option<serde_json::Value>=bytes.map(|data|serde_json::from_slice(&data).map_err(|_|"native_host_response_invalid".to_string())).transpose()?;
    Ok((status,json))
}

pub(crate) fn action(action:&str)->Result<serde_json::Value,String>{
    if !["status","preview","link","poll","disconnect","service","restart","update","open-wall","open-account","open-fleet","open-activation"].contains(&action){
        return Err("desktop_action_denied".into());
    }
    let (status,json)=call(&["--desktop-bridge".into(),action.into()])?;
    if status!=0{return Err("desktop_agent_unavailable".into());}
    json.ok_or_else(||"desktop_agent_invalid_response".into())
}

/// Dispatch before GUI mutex, Tauri, WebView and Owner vault initialization.
pub(crate) fn dispatch()->Option<i32>{
    let raw:Vec<_>=std::env::args_os().skip(1).collect();
    let role=raw.first()?.to_str()?.to_ascii_lowercase();
    if !["--agent-host","--managed-process","--self-test-output","--boot-evidence-self-test",
        "--wall-listener-self-test-output","--host-component-self-test-output","--desktop-bridge","--open-wall"].contains(&role.as_str()){return None;}
    let mut args=Vec::with_capacity(raw.len());
    for item in raw {
        let Some(text)=item.to_str() else {return Some(125);};
        args.push(text.to_string());
    }
    args[0]=role.clone();
    match call(&args){
        Ok((code,json))=>{
            if role=="--desktop-bridge"{
                if let Some(value)=json{
                    use std::io::Write;
                    let _=writeln!(std::io::stdout(),"{value}");
                }
            }
            Some(code)
        },
        Err(error)=>{eprintln!("light_remote_native_host:{error}");Some(126)}
    }
}
