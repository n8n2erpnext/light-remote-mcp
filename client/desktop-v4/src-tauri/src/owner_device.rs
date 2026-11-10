//! Current Owner + exact enrolled same-user device. No Wall cookies or bearer
//! enter the renderer. Fixed private IPC, bounded frames and action allowlist.
use serde_json::{json,Value};
use std::time::Duration;
const PIPE:&str=r"\\.\pipe\light-remote-desktop-v4-device";
const SOCKET:&str="desktop-device.sock";
pub(crate) const ACTIONS:&[&str]=&[
 "device.read","device.connect","device.disconnect","memory.read","codex.read","settings.read","module.configure",
 "memory.create","memory.capture","memory.archive","memory.restore","memory.delete-local",
 "memory.delete-account","memory.sync-policy","memory.sync-manual",
 "codex.task-create","codex.task-edit","codex.task-state","codex.task-delete",
 "codex.runtime-install","codex.runtime-remove","codex.login","codex.login-cancel","codex.logout","codex.account","codex.observe",
 "codex.preferences","codex.delegate","codex.pause","sessions.close","jobs.cancel","logs.configure","logs.clean"
];
fn deny()->String{"desktop_device_unavailable".into()}
pub(crate) fn valid_id(s:&str)->bool{
 !s.is_empty()&&s.len()<=160&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b"._:-".contains(&b))
}
fn private_fields(value:&Value)->bool{
 match value{
  Value::Object(map)=>map.iter().any(|(k,v)|
   ["access","access_token","refresh_token","cookie","csrf","privateKey","privateIdentityKey","deviceToken","memoryIdentity","publicIdentityKey"].contains(&k.as_str())||private_fields(v)),
  Value::Array(rows)=>rows.iter().any(private_fields),_=>false
 }
}
fn project(request:&Value,response:Value)->Result<Value,String>{
 if response.get("ok").and_then(Value::as_bool)!=Some(true){
  let code=response.get("error").and_then(Value::as_str).unwrap_or("desktop_device_unavailable");
  if code.len()<=120&&code.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'_'){
   return Err(code.into());
  }
  return Err(deny());
 }
 if response.get("accountId")!=request.get("accountId")||
   !response.get("deviceId").and_then(Value::as_str).is_some_and(valid_id)||
   (request.get("deviceId")!=Some(&Value::Null)&&response.get("deviceId")!=request.get("deviceId"))||
   !response.get("view").is_some_and(Value::is_object)||private_fields(&response){return Err(deny());}
 Ok(json!({"ok":true,"accountId":response["accountId"],"deviceId":response["deviceId"],"view":response["view"]}))
}
pub(crate) fn exchange(request:&Value)->Result<Value,String>{
 if !request.get("action").and_then(Value::as_str).is_some_and(|s|ACTIONS.contains(&s)){
  return Err("desktop_action_denied".into());
 }
 let mut line=serde_json::to_vec(request).map_err(|_|deny())?;line.push(b'\n');
 if line.len()>32768{return Err("desktop_request_too_large".into());}
 let mut bytes=Vec::with_capacity(4096);
 #[cfg(windows)]{
  use tokio::io::{AsyncReadExt,AsyncWriteExt};
  let runtime=tokio::runtime::Builder::new_current_thread().enable_io().enable_time().build().map_err(|_|deny())?;
  runtime.block_on(async{
   tokio::time::timeout(Duration::from_secs(16),async{
    let mut pipe=tokio::net::windows::named_pipe::ClientOptions::new().open(PIPE).map_err(|_|deny())?;
    pipe.write_all(&line).await.map_err(|_|deny())?;
    pipe.flush().await.map_err(|_|deny())?;
    pipe.take(262145).read_to_end(&mut bytes).await.map_err(|_|deny())?;
    Ok::<(),String>(())
   }).await.map_err(|_|"desktop_device_outcome_unknown".to_string())?
  })?;
 }
 #[cfg(unix)]{
  use std::io::{Read,Write};
  let home=std::env::var_os("HOME").ok_or_else(deny)?;
  let file=std::path::PathBuf::from(home).join(".light-remote").join(SOCKET);
  let mut stream=std::os::unix::net::UnixStream::connect(file).map_err(|_|deny())?;
  stream.set_read_timeout(Some(Duration::from_secs(16))).map_err(|_|deny())?;
  stream.set_write_timeout(Some(Duration::from_secs(16))).map_err(|_|deny())?;
  stream.write_all(&line).map_err(|_|deny())?;
  stream.take(262145).read_to_end(&mut bytes).map_err(|_|"desktop_device_outcome_unknown".to_string())?;
 }
 if bytes.len()>262144||bytes.last()!=Some(&b'\n'){return Err(deny());}
 let response:Value=serde_json::from_slice(&bytes[..bytes.len()-1]).map_err(|_|deny())?;
 project(request,response)
}
pub(crate) fn open_codex_verification(result:&Value)->Result<(),String>{
 let raw=result.get("view").and_then(|v|v.get("verificationUrl")).and_then(Value::as_str)
  .ok_or("desktop_codex_login_url_invalid")?;
 let url=url::Url::parse(raw).map_err(|_|"desktop_codex_login_url_invalid")?;
 if url.scheme()!="https"||!matches!(url.host_str(),Some("auth.openai.com"|"chatgpt.com"|"login.openai.com"))||
  !url.username().is_empty()||url.password().is_some()||url.port().is_some()||raw.len()>1000{
  return Err("desktop_codex_login_url_invalid".into());
 }
 #[cfg(windows)] let opened=std::process::Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler",raw]).spawn();
 #[cfg(target_os="macos")] let opened=std::process::Command::new("open").arg(raw).spawn();
 #[cfg(not(any(windows,target_os="macos")))] let opened=std::process::Command::new("xdg-open").arg(raw).spawn();
 opened.map(|_|()).map_err(|_|"desktop_browser_unavailable".into())
}
#[cfg(test)] mod tests{
 use super::*;
 #[test] fn device_projection_rejects_cross_binding_and_nested_credentials(){
  let req=json!({"accountId":"owner","deviceId":"device"});
  let good=json!({"ok":true,"accountId":"owner","deviceId":"device","view":{"asOf":1}});
  assert!(project(&req,good.clone()).is_ok());
  let mut wrong=good.clone();wrong["deviceId"]=json!("another");assert!(project(&req,wrong).is_err());
  let mut secret=good;secret["view"]["nested"]=json!({"refresh_token":"secret"});assert!(project(&req,secret).is_err());
 }
 #[test] fn native_device_discovery_is_account_bound(){
  let req=json!({"accountId":"owner","deviceId":null});
  assert!(project(&req,json!({"ok":true,"accountId":"other","deviceId":"device","view":{}})).is_err());
  assert!(!ACTIONS.contains(&"shell.run"));
 }
}
