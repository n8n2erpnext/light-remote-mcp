//! Desktop V4 native Owner login: system browser + bounded loopback OAuth
//! callback + native HTTPS token exchange. Feature OFF in current pilot.
//! The only Tauri IPC result is sanitized phase/accountId (never credentials).
//!
//! This is independent from ChatGPT's custom MCP endpoint and from the local
//! HTTP Wall. OAuth and refresh secrets remain in Rust / OS credential store.
#![allow(dead_code)]

use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    process::Command,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use reqwest::blocking::{Client, Response};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::State;
use url::Url;
use crate::owner_vault;

// Auth endpoints are compiled from the one canonical JSON, never a dynamic
// browser path, inherited env or fallback to regular Gold production.
fn auth_origin()->&'static str { crate::endpoint_config::cloud_origin("owner").unwrap_or("") }
fn authorize_url()->&'static str { crate::endpoint_config::route("ownerAuthorize").unwrap_or("") }
fn token_url()->&'static str { crate::endpoint_config::route("ownerToken").unwrap_or("") }
fn refresh_url()->&'static str { crate::endpoint_config::route("ownerRefresh").unwrap_or("") }
fn session_url()->&'static str { crate::endpoint_config::route("ownerSession").unwrap_or("") }
fn snapshot_url()->&'static str { crate::endpoint_config::route("ownerSnapshot").unwrap_or("") }
fn logout_url()->&'static str { crate::endpoint_config::route("ownerLogout").unwrap_or("") }
const RESOURCE: &str = "urn:light-remote:desktop-owner:v4";
const CLIENT_ID: &str = "light-remote-desktop-v4";
const SCOPE: &str = "desktop:read";
const CALLBACK_PATH: &str = "/desktop/v4/callback";

fn secret() -> String {
    let mut raw = [0u8; 32];
    OsRng.fill_bytes(&mut raw);
    URL_SAFE_NO_PAD.encode(raw)
}
fn token_ok(value: &str) -> bool {
    value.len() == 43 && value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
fn account_ok(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128 &&
        value.bytes().all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c))
}
fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

// Leave enough time for a bounded HTTPS refresh before the 10-minute access
// expires. Verification never extends an access token by itself.
const OWNER_CHECK_INTERVAL: Duration = Duration::from_secs(15);
const OWNER_REFRESH_MARGIN: Duration = Duration::from_secs(90);
// Waiting for the periodic Owner HTTPS check may improve native UI liveness,
// but timeout/rotation/revocation always deny. Never skip a pending check.
const OWNER_VERIFY_WAIT_MAX: Duration = Duration::from_millis(2500);
const OWNER_VERIFY_WAIT_TICK: Duration = Duration::from_millis(40);

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum OwnerPoll { Idle, Verify, Refresh }

fn next_owner_poll(s: &NativeSession, now: Instant) -> OwnerPoll {
    if s.phase != "verified" || s.status_inflight { return OwnerPoll::Idle; }
    if s.access_deadline.map_or(true, |deadline| deadline <= now + OWNER_REFRESH_MARGIN) {
        return OwnerPoll::Refresh;
    }
    if s.last_verified.map_or(true, |last| now.saturating_duration_since(last) >= OWNER_CHECK_INTERVAL) {
        OwnerPoll::Verify
    } else {
        OwnerPoll::Idle
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct OwnerView {
    pub phase: String,
    pub account_id: Option<String>,
}
struct NativeSession {
    phase: String,
    account_id: Option<String>,
    access_token: Option<String>,
    access_deadline: Option<Instant>,
    last_verified: Option<Instant>,
    status_inflight: bool,
    generation: u64,
}
impl NativeSession {
    fn expire(&mut self) {
        self.phase="expired".into();
        self.account_id=None;
        self.access_token=None;
        self.access_deadline=None;
        self.last_verified=None;
        self.status_inflight=false;
    }
}
impl Default for NativeSession {
    fn default() -> Self {
        Self { phase:"signed_out".into(),account_id:None,access_token:None,
            access_deadline:None,last_verified:None,status_inflight:false,generation:0 }
    }
}
#[derive(Default, Clone)]
pub(crate) struct OwnerRuntime {
    inner: Arc<Mutex<NativeSession>>,
}
impl OwnerRuntime {
    fn view(&self) -> Result<OwnerView,String> {
        let mut s = self.inner.lock().map_err(|_|"owner_state_unavailable")?;
        if s.phase=="verified" {
            let now=Instant::now();
            // A status poll may be renewing an expired access after wake from
            // sleep. Return no Owner proof until rotation actually commits.
            if s.status_inflight &&
               s.access_deadline.map_or(true, |d| d<=now+OWNER_REFRESH_MARGIN) {
                return Ok(OwnerView {phase:"restoring".into(),account_id:None});
            }
            if s.access_deadline.map_or(true, |d|now>=d) {s.expire();}
        }
        Ok(OwnerView {phase:s.phase.clone(),account_id:s.account_id.clone()})
    }
    fn transition(&self, phase:&str) -> Result<u64,String> {
        let mut s=self.inner.lock().map_err(|_|"owner_state_unavailable")?;
        if s.phase=="verified" {
            return Err("owner_signout_required".into());
        }
        if s.phase=="browser_pending" || s.phase=="restoring" {
            return Err("owner_login_already_pending".into());
        }
        s.generation=s.generation.wrapping_add(1);
        s.phase=phase.into();
        s.account_id=None;
        s.access_token=None;
        s.access_deadline=None;
        s.last_verified=None;
        s.status_inflight=false;
        Ok(s.generation)
    }
    fn finish(&self, generation:u64, result:Result<TokenSet,String>) {
        let Ok(mut s)=self.inner.lock() else { return; };
        // A cancelled/old browser attempt MUST NOT write a refresh token into
        // the vault after local Sign out. Burn its server-side family instead.
        if s.generation!=generation {
            drop(s);
            if let Ok(tokens)=result {
                if let Ok(client)=http(){revoke_remote(&client,&tokens.refresh_token);}
            }
            return;
        }
        s.status_inflight=false;
        match result {
            Ok(tokens)=>{
                // Hold the native state mutex through persistence so Sign out
                // cannot race a successful rotation into an orphaned vault.
                if let Err(_)=owner_vault::store_refresh(&tokens.refresh_token) {
                    s.phase="expired".into();
                    s.account_id=None;
                    s.access_token=None;
                    s.access_deadline=None;
                    s.last_verified=None;
                    drop(s);
                    if let Ok(client)=http(){revoke_remote(&client,&tokens.refresh_token);}
                    return;
                }
                s.phase="verified".into();
                s.account_id=Some(tokens.account_id);
                s.access_token=Some(tokens.access_token);
                s.access_deadline=Some(Instant::now()+Duration::from_secs(tokens.expires_in));
                s.last_verified=Some(Instant::now());
            }
            Err(error)=>{
                // Cold start after an explicit Sign out leaves no vault entry.
                // This is a legitimate signed-out state, NOT an expired or
                // revoked Owner session. Keep all other failures fail-closed.
                s.phase=if s.phase=="restoring" && error=="owner_not_signed_in" {
                    "signed_out".into()
                } else {
                    "expired".into()
                };
                s.account_id=None;
                s.access_token=None;
                s.access_deadline=None;
                s.last_verified=None;
            }
        }
    }
}
struct TokenSet {
    access_token:String,
    refresh_token:String,
    account_id:String,
    expires_in:u64,
}
fn http() -> Result<Client,String> {
    Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build().map_err(|_|"owner_https_unavailable".into())
}
fn read_json(mut response:Response) -> Result<Value,String> {
    if !response.status().is_success(){return Err("owner_authorization_rejected".into());}
    // Untrusted HTTP response body is capped at 8 KiB.
    let mut bounded=Vec::with_capacity(1024);
    response.take(8193).read_to_end(&mut bounded)
        .map_err(|_|"owner_https_unavailable")?;
    if bounded.len()>8192{return Err("owner_reply_oversize".into());}
    serde_json::from_slice(&bounded).map_err(|_|"owner_reply_invalid".into())
}
fn check_token_set(response:Value) -> Result<TokenSet,String> {
    let access=response.get("access_token").and_then(Value::as_str).unwrap_or("");
    let refresh=response.get("refresh_token").and_then(Value::as_str).unwrap_or("");
    let account=response.get("account_id").and_then(Value::as_str).unwrap_or("");
    let exp=response.get("expires_in").and_then(Value::as_u64).unwrap_or(0);
    if response.get("token_type").and_then(Value::as_str)!=Some("Bearer") ||
        response.get("scope").and_then(Value::as_str)!=Some(SCOPE) ||
        response.get("resource").and_then(Value::as_str)!=Some(RESOURCE) ||
        !token_ok(access) || !token_ok(refresh) || !account_ok(account) ||
        exp==0 || exp>600 {
        return Err("owner_reply_invalid".into());
    }
    Ok(TokenSet {
        access_token:access.into(),refresh_token:refresh.into(),
        account_id:account.into(),expires_in:exp
    })
}
fn revoke_remote(client:&Client, refresh:&str) {
    if token_ok(refresh) {
        let _=client.post(logout_url()).json(&json!({"refresh_token":refresh})).send();
    }
}
fn exchange(code:&str, verifier:&str, redirect:&str, install_nonce:&str, state:&str)
        -> Result<TokenSet,String> {
    let client=http()?;
    let response=client.post(token_url()).json(&json!({
        "code":code,"code_verifier":verifier,"redirect_uri":redirect,
        "install_nonce":install_nonce,"state":state
    })).send().map_err(|_|"owner_https_unavailable")?;
    let received=check_token_set(read_json(response)?)?;
    // The generation-checked native OwnerRuntime persists the rotating
    // refresh token atomically with presentation of verified Owner state.
    Ok(received)
}
fn refresh_from_vault() -> Result<TokenSet,String> {
    let existing=owner_vault::read_refresh()?
        .ok_or_else(||"owner_not_signed_in".to_string())?;
    let client=http()?;
    let response=client.post(refresh_url())
        .json(&json!({"refresh_token":existing}))
        .send().map_err(|_|"owner_https_unavailable")?;
    let received=match read_json(response).and_then(check_token_set) {
        Ok(tokens)=>tokens,
        Err(error)=>return Err(error)
    };
    // Storage is handled by OwnerRuntime.finish only if still current.
    Ok(received)
}
fn auth_url(redirect:&str, verifier:&str, state:&str, install_nonce:&str)
        -> Result<String,String> {
    let mut url=Url::parse(authorize_url()).map_err(|_|"owner_url_invalid")?;
    url.query_pairs_mut()
        .append_pair("client_id",CLIENT_ID)
        .append_pair("resource",RESOURCE)
        .append_pair("scope",SCOPE)
        .append_pair("response_type","code")
        .append_pair("code_challenge_method","S256")
        .append_pair("code_challenge",&challenge(verifier))
        .append_pair("redirect_uri",redirect)
        .append_pair("state",state)
        .append_pair("install_nonce",install_nonce);
    Ok(url.to_string())
}
fn system_browser(url:&str) -> Result<(),String> {
    if !url.starts_with(authorize_url()) {return Err("owner_url_invalid".into());}
    #[cfg(target_os="windows")]
    let result=Command::new("rundll32.exe").arg("url.dll,FileProtocolHandler").arg(url).spawn();
    #[cfg(target_os="macos")]
    let result=Command::new("open").arg(url).spawn();
    #[cfg(not(any(target_os="windows",target_os="macos")))]
    let result=Command::new("xdg-open").arg(url).spawn();
    result.map(|_|()).map_err(|_|"owner_browser_unavailable".into())
}
fn validate_callback(target:&str, state:&str) -> Result<String,String> {
    if target.len()>1800 || !target.starts_with(CALLBACK_PATH) ||
        target.bytes().any(|b| b<0x20 || b==0x7f) {
        return Err("owner_callback_invalid".into());
    }
    let url=Url::parse(&format!("http://127.0.0.1{}",target))
        .map_err(|_|"owner_callback_invalid")?;
    if url.path()!=CALLBACK_PATH || url.fragment().is_some() {
        return Err("owner_callback_invalid".into());
    }
    let mut code=None;let mut returned_state=None;let mut issuer=None;let mut error=None;
    for (k,v) in url.query_pairs() {
        match k.as_ref() {
            "code" if code.is_none()=>code=Some(v.into_owned()),
            "state" if returned_state.is_none()=>returned_state=Some(v.into_owned()),
            "iss" if issuer.is_none()=>issuer=Some(v.into_owned()),
            "error" if error.is_none()=>error=Some(v.into_owned()),
            _=>return Err("owner_callback_invalid".into())
        }
    }
    if returned_state.as_deref()!=Some(state) || issuer.as_deref()!=Some(auth_origin()){
        return Err("owner_callback_mismatch".into());
    }
    if error.as_deref()==Some("access_denied") && code.is_none(){
        return Err("owner_consent_denied".into());
    }
    let code=code.ok_or_else(||"owner_callback_invalid".to_string())?;
    if !token_ok(&code) || error.is_some(){return Err("owner_callback_invalid".into());}
    Ok(code)
}
fn respond(mut client:TcpStream, ok:bool) {
    let msg=if ok { "Return to Light Remote Desktop. Sign-in result received." }
        else { "This sign-in request was not accepted. Return to Light Remote Desktop." };
    let response=format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        msg.len(),msg);
    let _=client.write_all(response.as_bytes());
}
fn capture(listener:TcpListener, state:&str, port:u16) -> Result<String,String> {
    listener.set_nonblocking(true).map_err(|_|"owner_callback_unavailable")?;
    let deadline=Instant::now()+Duration::from_secs(120);
    while Instant::now()<deadline {
        match listener.accept() {
            Ok((mut client,_))=>{
                client.set_read_timeout(Some(Duration::from_secs(2))).ok();
                let mut b=[0u8;4096];
                let n=match client.read(&mut b) {
                    Ok(n) if n>0=>n,
                    _=>{respond(client,false);continue;}
                };
                let raw=match std::str::from_utf8(&b[..n]) {
                    Ok(t)=>t,_=>{respond(client,false);continue;}
                };
                let mut lines=raw.split("\r\n");
                let first=lines.next().unwrap_or("");
                let expected_host=format!("127.0.0.1:{}",port);
                let mut host_count=0usize;
                let mut host_valid=false;
                for line in lines {
                    if let Some((name,value))=line.split_once(':') {
                        if name.eq_ignore_ascii_case("host") {
                            host_count+=1;
                            host_valid=value.trim()==expected_host;
                        }
                    }
                }
                if host_count!=1 || !host_valid ||
                    !first.starts_with("GET ") || !first.ends_with(" HTTP/1.1") {
                    respond(client,false);
                    continue;
                }
                let target=first.strip_prefix("GET ").unwrap_or("")
                    .strip_suffix(" HTTP/1.1").unwrap_or("");
                let outcome=validate_callback(target,state);
                respond(client,outcome.is_ok());
                match outcome {
                    Ok(code)=>return Ok(code),
                    Err(error) if error=="owner_consent_denied"=>return Err(error),
                    Err(_)=>continue
                }
            }
            Err(error) if error.kind()==std::io::ErrorKind::WouldBlock=>
                thread::sleep(Duration::from_millis(50)),
            Err(_)=>return Err("owner_callback_unavailable".into()),
        }
    }
    Err("owner_callback_expired".into())
}

#[tauri::command]
pub(crate) fn desktop_owner_begin(state:State<'_,OwnerRuntime>) -> Result<OwnerView,String> {
    let listener=TcpListener::bind("127.0.0.1:0")
        .map_err(|_|"owner_callback_unavailable")?;
    let port=listener.local_addr().map_err(|_|"owner_callback_unavailable")?.port();
    if port<1024 {return Err("owner_callback_unavailable".into());}
    let redirect=format!("http://127.0.0.1:{}{}",port,CALLBACK_PATH);
    let verifier=secret();let csrf_state=secret();let install_nonce=secret();
    let url=auth_url(&redirect,&verifier,&csrf_state,&install_nonce)?;
    let generation=state.transition("browser_pending")?;
    let runtime=OwnerRuntime { inner:Arc::clone(&state.inner) };
    if let Err(error)=system_browser(&url) {
        runtime.finish(generation,Err(error.clone()));
        return Err(error);
    }
    thread::spawn(move||{
        let result=capture(listener,&csrf_state,port)
            .and_then(|code|exchange(&code,&verifier,&redirect,&install_nonce,&csrf_state));
        runtime.finish(generation,result);
    });
    state.view()
}
// HTTPS session checks and refreshes are serialized per native runtime, not
// per React poll. A slow validation must never overwrite a newer rotation or
// resurrect a session invalidated by Sign out.
fn verify_owner_session(access: &str, account: &str) -> bool {
    let response=http().and_then(|client|{
        let res=client.get(session_url()).bearer_auth(access)
            .send().map_err(|_|"owner_https_unavailable")?;
        read_json(res)
    });
    response.is_ok_and(|value|
        value.get("verified").and_then(Value::as_bool)==Some(true) &&
        value.get("accountId").and_then(Value::as_str)==Some(account) &&
        value.get("resource").and_then(Value::as_str)==Some(RESOURCE) &&
        value.get("scope").and_then(Value::as_str)==Some(SCOPE))
}

fn finish_owner_verification(runtime: &OwnerRuntime, generation: u64,
                              expected_access: &str, verified: bool) {
    let Ok(mut s)=runtime.inner.lock() else {return;};
    if s.generation!=generation || s.phase!="verified" ||
       !s.status_inflight || s.access_token.as_deref()!=Some(expected_access) {
        return;
    }
    s.status_inflight=false;
    if verified {s.last_verified=Some(Instant::now());}
    else {s.expire();}
}

// Returns a newly rotated credential to revoke if the result is stale, the
// server changed Owner, or private OS-vault persistence fails. Never commit a
// new refresh after logout. Hold the native mutex across the vault write so
// logout cannot delete the old credential before a late refresh overwrites it.
fn finish_owner_refresh<F>(runtime: &OwnerRuntime, generation: u64,
                           expected_account: &str, result: Result<TokenSet,String>,
                           persist: F) -> Option<String>
where F: FnOnce(&str) -> Result<(),String> {
    let Ok(mut s)=runtime.inner.lock() else {
        return result.ok().map(|tokens|tokens.refresh_token);
    };
    if s.generation!=generation || s.phase!="verified" || !s.status_inflight {
        return result.ok().map(|tokens|tokens.refresh_token);
    }
    s.status_inflight=false;
    match result {
        Ok(tokens) if tokens.account_id==expected_account => {
            if persist(&tokens.refresh_token).is_err() {
                s.expire();
                return Some(tokens.refresh_token);
            }
            s.access_token=Some(tokens.access_token);
            s.access_deadline=Some(Instant::now()+Duration::from_secs(tokens.expires_in));
            // The refresh endpoint itself rechecks the exact Portal Owner
            // session and its original expiry before issuing new credentials.
            s.last_verified=Some(Instant::now());
            None
        }
        Ok(tokens) => {
            s.expire();
            Some(tokens.refresh_token)
        }
        Err(_) => {
            // Network loss, revoked Portal session, locked keyring or an
            // ambiguous refresh failure must never preserve Owner authority.
            s.expire();
            None
        }
    }
}

fn revalidate_owner(runtime:&OwnerRuntime) -> Result<OwnerView,String> {
    let pending={
        let mut s=runtime.inner.lock().map_err(|_|"owner_state_unavailable")?;
        let action=next_owner_poll(&s,Instant::now());
        if action==OwnerPoll::Idle {None}
        else {
            s.status_inflight=true;
            Some((action,s.generation,s.account_id.clone(),s.access_token.clone()))
        }
    };
    let Some((action,generation,account,access))=pending else {return runtime.view();};
    match action {
        OwnerPoll::Refresh => {
            // Also applies after sleep/resume if the 10m access already expired:
            // during rotation the sanitized UI is "restoring", not "verified".
            let rotated=finish_owner_refresh(runtime,generation,
                account.as_deref().unwrap_or(""),refresh_from_vault(),
                owner_vault::store_refresh);
            if let Some(secret)=rotated {
                if let Ok(client)=http() {revoke_remote(&client,&secret);}
            }
        }
        OwnerPoll::Verify => {
            let ok=match (access.as_deref(),account.as_deref()) {
                (Some(token),Some(owner))=>verify_owner_session(token,owner),
                _=>false
            };
            finish_owner_verification(runtime,generation,
                access.as_deref().unwrap_or(""),ok);
        }
        OwnerPoll::Idle => {}
    }
    runtime.view()
}
#[tauri::command]
pub(crate) async fn desktop_owner_status(state:State<'_,OwnerRuntime>) -> Result<OwnerView,String> {
    let runtime=OwnerRuntime {inner:Arc::clone(&state.inner)};
    tauri::async_runtime::spawn_blocking(move||revalidate_owner(&runtime))
        .await.map_err(|_|"owner_state_unavailable".to_string())?
}
#[tauri::command]
pub(crate) fn desktop_owner_restore(state:State<'_,OwnerRuntime>) -> Result<OwnerView,String> {
    let generation=state.transition("restoring")?;
    let runtime=OwnerRuntime { inner:Arc::clone(&state.inner) };
    thread::spawn(move||runtime.finish(generation,refresh_from_vault()));
    state.view()
}
#[tauri::command]
pub(crate) fn desktop_owner_logout(state:State<'_,OwnerRuntime>) -> Result<OwnerView,String> {
    let access={
        let mut s=state.inner.lock().map_err(|_|"owner_state_unavailable")?;
        s.generation=s.generation.wrapping_add(1);
        s.phase="signed_out".into();
        s.account_id=None;
        s.access_deadline=None;
        s.last_verified=None;
        s.status_inflight=false;
        s.access_token.take()
    };
    let stored=owner_vault::read_refresh()?;
    // Delete even if the server is offline. No credentials remain on device.
    owner_vault::remove_refresh()?;
    // Prefer the rotating refresh in OS vault over an older access token;
    // a revoked/expired access token must not prevent family invalidation.
    if let Some(value)=stored.or(access) {
        let client=http()?;
        client.post(logout_url())
            .header("Authorization",format!("Bearer {}",value))
            .json(&json!({}))
            .send().map_err(|_|"owner_server_logout_unconfirmed")?
            .error_for_status().map_err(|_|"owner_server_logout_unconfirmed")?;
    }
    state.view()
}


// T04b9c3b2: private Owner-generation-fenced Wall handoff. Only native
// Rust can read this snapshot. No Tauri command is published and React
// cannot pass an access/refresh token or receive a one-use Wall ticket.
struct NativeOwnerWallSnapshot {
    generation:u64,
    account:String,
    access:String,
}
fn wall_sso_denied() -> String {
    "desktop_wall_sso_native_owner_unavailable".into()
}
impl OwnerRuntime {
    fn wall_snapshot(&self) -> Result<NativeOwnerWallSnapshot,String> {
        let s=self.inner.lock().map_err(|_|wall_sso_denied())?;
        if s.phase!="verified" || s.status_inflight ||
           s.access_deadline.map_or(true,|d|
               d<=Instant::now()+OWNER_REFRESH_MARGIN) {
            return Err(wall_sso_denied());
        }
        let account=s.account_id.as_deref().ok_or_else(wall_sso_denied)?;
        let access=s.access_token.as_deref().ok_or_else(wall_sso_denied)?;
        if !account_ok(account)||!token_ok(access) {
            return Err(wall_sso_denied());
        }
        Ok(NativeOwnerWallSnapshot {
            generation:s.generation,account:account.into(),access:access.into()
        })
    }
    fn wall_snapshot_current(&self,snap:&NativeOwnerWallSnapshot) -> bool {
        let Ok(s)=self.inner.lock() else{return false;};
        s.phase=="verified" && !s.status_inflight &&
            s.generation==snap.generation &&
            s.account_id.as_deref()==Some(snap.account.as_str()) &&
            s.access_token.as_deref()==Some(snap.access.as_str()) &&
            s.access_deadline.is_some_and(|d|
                d>Instant::now()+OWNER_REFRESH_MARGIN)
    }
    // Preserve the exact generation, account, token and pre-check timestamp
    // while waiting. A concurrent Sign out/Owner switch/refresh MUST NOT be
    // allowed to switch the requested operation to another credential.
    fn wall_verification_anchor(&self) -> Result<(NativeOwnerWallSnapshot,Option<Instant>),String> {
        let s=self.inner.lock().map_err(|_|wall_sso_denied())?;
        if s.phase!="verified" || !s.status_inflight ||
           s.access_deadline.map_or(true,|d|
               d<=Instant::now()+OWNER_REFRESH_MARGIN) {
            return Err(wall_sso_denied());
        }
        let account=s.account_id.as_deref().ok_or_else(wall_sso_denied)?;
        let access=s.access_token.as_deref().ok_or_else(wall_sso_denied)?;
        if !account_ok(account)||!token_ok(access){return Err(wall_sso_denied());}
        Ok((NativeOwnerWallSnapshot {
            generation:s.generation,account:account.into(),access:access.into()
        },s.last_verified))
    }

    async fn wall_wait_for_verified_anchor(
        &self,snap:&NativeOwnerWallSnapshot,prior:Option<Instant>,budget:Duration
    ) -> bool {
        let deadline=Instant::now()+budget;
        loop {
            {
                let Ok(s)=self.inner.lock() else{return false;};
                if s.phase!="verified" || s.generation!=snap.generation ||
                   s.account_id.as_deref()!=Some(snap.account.as_str()) ||
                   s.access_token.as_deref()!=Some(snap.access.as_str()) ||
                   s.access_deadline.map_or(true,|d|
                       d<=Instant::now()+OWNER_REFRESH_MARGIN) {
                    return false;
                }
                if !s.status_inflight {
                    // A cleared flag alone is insufficient: the HTTPS check
                    // must positively update last_verified before projection.
                    return s.last_verified.is_some_and(|t|
                        prior.map_or(true,|before|t>before));
                }
            }
            if Instant::now()>=deadline{return false;}
            tokio::time::sleep(OWNER_VERIFY_WAIT_TICK).await;
        }
    }

    async fn wall_snapshot_after_verification_with_budget(
        &self,budget:Duration
    ) -> Result<NativeOwnerWallSnapshot,String> {
        if let Ok(snap)=self.wall_snapshot(){return Ok(snap);}
        let (anchor,prior)=self.wall_verification_anchor()?;
        if !self.wall_wait_for_verified_anchor(&anchor,prior,budget).await {
            return Err(wall_sso_denied());
        }
        let current=self.wall_snapshot()?;
        if current.generation!=anchor.generation ||
           current.account!=anchor.account || current.access!=anchor.access {
            return Err(wall_sso_denied());
        }
        Ok(current)
    }
    async fn wall_snapshot_after_verification(&self)
        -> Result<NativeOwnerWallSnapshot,String> {
        self.wall_snapshot_after_verification_with_budget(OWNER_VERIFY_WAIT_MAX).await
    }

    async fn wall_snapshot_current_after_verification_with_budget(
        &self,snap:&NativeOwnerWallSnapshot,budget:Duration
    ) -> bool {
        if self.wall_snapshot_current(snap){return true;}
        let Ok((anchor,prior))=self.wall_verification_anchor() else{return false;};
        if anchor.generation!=snap.generation ||
           anchor.account!=snap.account || anchor.access!=snap.access {
            return false;
        }
        self.wall_wait_for_verified_anchor(snap,prior,budget).await &&
            self.wall_snapshot_current(snap)
    }
    async fn wall_snapshot_current_after_verification(
        &self,snap:&NativeOwnerWallSnapshot
    ) -> bool {
        self.wall_snapshot_current_after_verification_with_budget(
            snap,OWNER_VERIFY_WAIT_MAX).await
    }

    fn wall_expire_if_snapshot_current(&self,snap:&NativeOwnerWallSnapshot) {
        if let Ok(mut s)=self.inner.lock(){
            if s.generation==snap.generation &&
               s.access_token.as_deref()==Some(snap.access.as_str()) {
                s.expire();
            }
        }
    }
}

/// Source-only native orchestration for a future explicit Owner UI action.
/// Caller supplies *public* 43-character browser challenge + selected Device
/// ID, never a ticket. The HTTPS issuer rechecks Owner enrollment and scope;
/// the OS-local Agent IPC requires the actual enrolled Device signer and
/// cannot be replaced with an HTTP endpoint. A stale generation cannot
/// finish after Owner Sign out / refresh rotation.
pub(crate) async fn approve_private_owner_wall_sso(
    runtime:OwnerRuntime,challenge:String,device_id:String
) -> Result<(),String> {
    if !token_ok(&challenge)||!crate::owner_wall_ticket::device_id_ok(&device_id) {
        return Err(wall_sso_denied());
    }
    let snap=runtime.wall_snapshot_after_verification().await?;
    let account=snap.account.clone();
    let access=snap.access.clone();
    let verified=tauri::async_runtime::spawn_blocking(move||
        verify_owner_session(&access,&account)
    ).await.map_err(|_|wall_sso_denied())?;
    if !verified{
        runtime.wall_expire_if_snapshot_current(&snap);
        return Err(wall_sso_denied());
    }
    if !runtime.wall_snapshot_current_after_verification(&snap).await{return Err(wall_sso_denied());}
    let token=snap.access.clone();
    let selected=device_id.clone();
    let ticket=tauri::async_runtime::spawn_blocking(move||
        crate::owner_wall_ticket::request_native_wall_ticket(&token,&selected)
    ).await.map_err(|_|wall_sso_denied())?
        .map_err(|_|wall_sso_denied())?;
    if !runtime.wall_snapshot_current_after_verification(&snap).await ||
       ticket.device_id()!=device_id {
        return Err(wall_sso_denied());
    }
    crate::owner_wall_ticket::relay_native_wall_ticket_to_agent(
        &challenge,&ticket
    ).await.map_err(|_|wall_sso_denied())?;
    if !runtime.wall_snapshot_current_after_verification(&snap).await{
        return Err(wall_sso_denied());
    }
    Ok(())
}


/// T04b9c3c — the Owner can ONLY enter the short public browser code.
/// The private full challenge and enrolled Device ID come from the
/// same-device OS-only Agent IPC, never from React/URL/user arguments.
/// Feature remains unmounted on the Agent and default OFF in UI builds.
#[tauri::command]
pub(crate) async fn desktop_owner_wall_sso_approve(
    state:State<'_,OwnerRuntime>,approval_code:String
) -> Result<OwnerView,String> {
    // Local Wall selection is fixed to this host's 127.0.0.1:5491.
    // Never authorize a remote NetBird/LXD Wall from this desktop command.
    if approval_code.len()!=8 ||
        !approval_code.bytes().all(|b|
          b.is_ascii_alphanumeric()||b==b'-'||b==b'_') {
        return Err(wall_sso_denied());
    }
    let runtime=OwnerRuntime {inner:Arc::clone(&state.inner)};
    // Must be a verified, non-refreshing Owner before even querying pending.
    runtime.wall_snapshot_after_verification().await?;
    let pending=crate::owner_wall_ticket::read_private_wall_pending_from_agent()
        .await.map_err(|_|wall_sso_denied())?;
    if !pending.challenge.starts_with(&approval_code) {
        return Err(wall_sso_denied());
    }
    approve_private_owner_wall_sso(
        runtime.clone(),pending.challenge,pending.device_id
    ).await?;
    runtime.view()
}


// T06: Owner-only read snapshot from the public GoldABV2 HTTPS endpoint.
// Native Rust alone handles the 10-minute token. A stale Owner generation,
// missing server family or invalid response never reaches the React workspace.
#[tauri::command]
pub(crate) async fn desktop_owner_snapshot(
    state:State<'_,OwnerRuntime>
) -> Result<Value,String> {
    let runtime=OwnerRuntime {inner:Arc::clone(&state.inner)};
    let snap=runtime.wall_snapshot_after_verification().await.map_err(|_|"desktop_owner_data_unavailable")?;
    let account=snap.account.clone();
    let access=snap.access.clone();
    let result=tauri::async_runtime::spawn_blocking(move|| {
        if !verify_owner_session(&access,&account) {
            return Err("desktop_owner_data_unavailable".to_string());
        }
        let response=http().map_err(|_|"desktop_owner_data_unavailable".to_string())?
            .post(snapshot_url()).bearer_auth(&access).json(&json!({}))
            .send().map_err(|_|"desktop_owner_data_unavailable".to_string())?;
        if !response.status().is_success() {
            return Err("desktop_owner_data_unavailable".into());
        }
        let bytes=response.bytes().map_err(|_|"desktop_owner_data_unavailable".to_string())?;
        if bytes.len()>262_144 {
            return Err("desktop_owner_data_unavailable".into());
        }
        let value:Value=serde_json::from_slice(&bytes)
            .map_err(|_|"desktop_owner_data_unavailable".to_string())?;
        if value.get("ok").and_then(Value::as_bool)!=Some(true)||
           value.get("accountId").and_then(Value::as_str)!=Some(account.as_str())||
           !value.get("devices").is_some_and(Value::is_array)||
           !value.get("sessions").is_some_and(Value::is_array)||
           !value.get("grants").is_some_and(Value::is_array)||
           !value.get("jobs").is_some_and(Value::is_array)||
           !value.get("events").is_some_and(Value::is_array) {
            return Err("desktop_owner_data_unavailable".into());
        }
        Ok(value)
    }).await.map_err(|_|"desktop_owner_data_unavailable".to_string())??;
    if !runtime.wall_snapshot_current_after_verification(&snap).await {
        return Err("desktop_owner_data_unavailable".into());
    }
    Ok(result)
}

// T11-F14: one verified Owner inventory page. JS never sees the bearer and
// can only select a read-only kind/cursor; native verifies Owner before/after.
#[tauri::command]
pub(crate) async fn desktop_owner_inventory_page(
    state:State<'_,OwnerRuntime>,kind:String,cursor:Option<String>
) -> Result<Value,String> {
    if kind!="devices" && kind!="grants" && kind!="usage" && kind!="jobs" && kind!="sessions" {
        return Err("desktop_inventory_unavailable".into());
    }
    if let Some(ref value)=cursor {
        if value.len()>512 || !value.bytes().all(|b|
            b.is_ascii_alphanumeric() || b==b'-' || b==b'_') {
            return Err("desktop_inventory_unavailable".into());
        }
    }
    let runtime=OwnerRuntime {inner:Arc::clone(&state.inner)};
    let snap=runtime.wall_snapshot_after_verification().await
        .map_err(|_|"desktop_inventory_unavailable")?;
    let account=snap.account.clone();
    let access=snap.access.clone();
    let requested_kind=kind.clone();
    let result=tauri::async_runtime::spawn_blocking(move|| {
        if !verify_owner_session(&access,&account) {
            return Err("desktop_inventory_unavailable".to_string());
        }
        let response=http().map_err(|_|"desktop_inventory_unavailable".to_string())?
            .post(snapshot_url()).bearer_auth(&access)
            .json(&json!({"page":{"kind":requested_kind,"cursor":cursor,"limit":100}}))
            .send().map_err(|_|"desktop_inventory_unavailable".to_string())?;
        if !response.status().is_success() {
            return Err("desktop_inventory_unavailable".into());
        }
        let bytes=response.bytes().map_err(|_|"desktop_inventory_unavailable".to_string())?;
        if bytes.len()>262_144 {
            return Err("desktop_inventory_unavailable".into());
        }
        let value:Value=serde_json::from_slice(&bytes)
            .map_err(|_|"desktop_inventory_unavailable".to_string())?;
        if value.get("ok").and_then(Value::as_bool)!=Some(true)||
           value.get("accountId").and_then(Value::as_str)!=Some(account.as_str())||
           value.get("kind").and_then(Value::as_str)!=Some(kind.as_str())||
           !value.get("rows").is_some_and(Value::is_array)||
           value.get("rows").and_then(Value::as_array).is_some_and(|v|v.len()>100)||
           !value.get("coverage").is_some_and(Value::is_object) {
            return Err("desktop_inventory_unavailable".into());
        }
        Ok(value)
    }).await.map_err(|_|"desktop_inventory_unavailable".to_string())??;
    if !runtime.wall_snapshot_current_after_verification(&snap).await {
        return Err("desktop_inventory_unavailable".into());
    }
    Ok(result)
}

// T05: Real owner-bound pending A/B V2 and B approval via OS-local Agent.
// The native Owner bearer is sent ONLY to its local Agent's private socket;
// React receives just a sanitized pending row set and approval result.
// The Agent verifies current GoldABV2 Owner, enrolled account and signs the
// existing ABV2 Operator channel. No current Windows Gold Agent was modified.
#[tauri::command]
pub(crate) async fn desktop_owner_abv2_pending(
    state:State<'_,OwnerRuntime>
) -> Result<Value,String> {
    let runtime=OwnerRuntime {inner:Arc::clone(&state.inner)};
    let snap=runtime.wall_snapshot_after_verification().await.map_err(|_|"desktop_abv2_owner_required")?;
    let account=snap.account.clone();
    let access=snap.access.clone();
    let result=tauri::async_runtime::spawn_blocking(move|| {
        if !verify_owner_session(&access,&account) {
            return Err("desktop_abv2_owner_required".to_string());
        }
        crate::owner_abv2::exchange(&json!({"action":"pending","access":access}))
    }).await.map_err(|_|"desktop_abv2_native_unavailable".to_string())??;
    if !runtime.wall_snapshot_current_after_verification(&snap).await {
        return Err("desktop_abv2_owner_required".into());
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn desktop_owner_abv2_approve(
    state:State<'_,OwnerRuntime>,
    request_id:String,expected_attempt:u64,b_code:String,consent_code:String
) -> Result<Value,String> {
    let valid_id=request_id.len()==36&&request_id.starts_with("av2_")&&
        request_id[4..].bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase());
    let valid_b=b_code.len()==9&&b_code.as_bytes()[4]==b'-'&&
        b_code.bytes().enumerate().all(|(i,b)|i==4||b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains(&b));
    let valid_consent=consent_code.is_empty()||
        (consent_code.len()==32&&consent_code.bytes().all(|b|
          b.is_ascii_alphanumeric()||b==b'-'||b==b'_'));
    if !valid_id||expected_attempt==0||expected_attempt>1_000_000||
       !valid_b||!valid_consent {
        return Err("desktop_abv2_invalid_request".into());
    }
    let runtime=OwnerRuntime {inner:Arc::clone(&state.inner)};
    let snap=runtime.wall_snapshot_after_verification().await.map_err(|_|"desktop_abv2_owner_required")?;
    let account=snap.account.clone();
    let access=snap.access.clone();
    let result=tauri::async_runtime::spawn_blocking(move||{
        if !verify_owner_session(&access,&account) {
            return Err("desktop_abv2_owner_required".into());
        }
        crate::owner_abv2::exchange(&json!({
            "action":"approve","access":access,"requestId":request_id,
            "expectedAttempt":expected_attempt,"bCode":b_code,
            "consentCode":consent_code
        }))
    }).await.map_err(|_|"desktop_abv2_native_unavailable".to_string())??;
    if !runtime.wall_snapshot_current_after_verification(&snap).await {
        return Err("desktop_abv2_owner_required".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounded_await<F:std::future::Future>(future:F) -> F::Output {
        tokio::runtime::Builder::new_current_thread().enable_time()
            .build().unwrap().block_on(future)
    }
    #[test]
    fn t11_f10_verify_inflight_bounded_wait_accepts_same_owner_only_after_https_success() {
        let now=Instant::now();
        let runtime=owner_with_deadline(now+Duration::from_secs(550),Some(now));
        runtime.inner.lock().unwrap().status_inflight=true;
        let for_verify=runtime.clone();
        let worker=thread::spawn(move||{
            thread::sleep(Duration::from_millis(65));
            finish_owner_verification(&for_verify,4,&"A".repeat(43),true);
        });
        let snap=bounded_await(runtime.wall_snapshot_after_verification_with_budget(
            Duration::from_millis(480))).unwrap();
        worker.join().unwrap();
        assert_eq!(snap.account,"owner1");
        assert_eq!(snap.generation,4);
        assert!(runtime.wall_snapshot_current(&snap));
    }
    #[test]
    fn t11_f10_mid_read_verify_success_preserves_old_generation_projection() {
        let now=Instant::now();
        let runtime=owner_with_deadline(now+Duration::from_secs(550),Some(now));
        let snap=runtime.wall_snapshot().unwrap();
        runtime.inner.lock().unwrap().status_inflight=true;
        let for_verify=runtime.clone();
        let worker=thread::spawn(move||{
            thread::sleep(Duration::from_millis(65));
            finish_owner_verification(&for_verify,4,&"A".repeat(43),true);
        });
        assert!(bounded_await(runtime.wall_snapshot_current_after_verification_with_budget(
            &snap,Duration::from_millis(480))));
        worker.join().unwrap();
        assert!(runtime.wall_snapshot_current(&snap));
    }
    #[test]
    fn t11_f10_revocation_during_verify_cannot_approve_or_project_owner_data() {
        let now=Instant::now();
        let runtime=owner_with_deadline(now+Duration::from_secs(550),Some(now));
        let snap=runtime.wall_snapshot().unwrap();
        runtime.inner.lock().unwrap().status_inflight=true;
        let for_verify=runtime.clone();
        let worker=thread::spawn(move||{
            thread::sleep(Duration::from_millis(65));
            finish_owner_verification(&for_verify,4,&"A".repeat(43),false);
        });
        assert!(!bounded_await(runtime.wall_snapshot_current_after_verification_with_budget(
            &snap,Duration::from_millis(480))));
        worker.join().unwrap();
        assert_eq!(runtime.view().unwrap().phase,"expired");
        assert!(runtime.wall_snapshot().is_err());
    }
    #[test]
    fn t11_f10_signout_during_wait_does_not_switch_to_new_owner() {
        let now=Instant::now();
        let runtime=owner_with_deadline(now+Duration::from_secs(550),Some(now));
        runtime.inner.lock().unwrap().status_inflight=true;
        let switch=runtime.clone();
        let worker=thread::spawn(move||{
            thread::sleep(Duration::from_millis(65));
            let mut s=switch.inner.lock().unwrap();
            s.generation+=1;
            s.account_id=Some("different".into());
            s.access_token=Some("B".repeat(43));
            s.status_inflight=false;
        });
        assert!(bounded_await(runtime.wall_snapshot_after_verification_with_budget(
            Duration::from_millis(480))).is_err());
        worker.join().unwrap();
        // This method must never silently promote a different Owner.
        assert_eq!(runtime.inner.lock().unwrap().generation,5);
    }
    #[test]
    fn t11_f10_refresh_rotation_during_wait_rejects_original_owner_token() {
        let now=Instant::now();
        let runtime=owner_with_deadline(now+Duration::from_secs(550),Some(now));
        let snap=runtime.wall_snapshot().unwrap();
        runtime.inner.lock().unwrap().status_inflight=true;
        let rotate=runtime.clone();
        let worker=thread::spawn(move||{
            thread::sleep(Duration::from_millis(65));
            let mut s=rotate.inner.lock().unwrap();
            s.access_token=Some("B".repeat(43));
            s.last_verified=Some(Instant::now());
            s.status_inflight=false;
        });
        assert!(!bounded_await(runtime.wall_snapshot_current_after_verification_with_budget(
            &snap,Duration::from_millis(480))));
        worker.join().unwrap();
    }
    #[test]
    fn t11_f10_stuck_verification_is_bounded_and_never_grants() {
        let now=Instant::now();
        let runtime=owner_with_deadline(now+Duration::from_secs(550),Some(now));
        runtime.inner.lock().unwrap().status_inflight=true;
        let start=Instant::now();
        assert!(bounded_await(runtime.wall_snapshot_after_verification_with_budget(
            Duration::from_millis(125))).is_err());
        assert!(start.elapsed()<Duration::from_secs(1));
        assert!(runtime.inner.lock().unwrap().status_inflight);
    }
    #[test]
    fn t11_f10_cleared_inflight_without_positive_https_timestamp_denies() {
        let now=Instant::now();
        let runtime=owner_with_deadline(now+Duration::from_secs(550),Some(now));
        let snap=runtime.wall_snapshot().unwrap();
        runtime.inner.lock().unwrap().status_inflight=true;
        let bypass=runtime.clone();
        let worker=thread::spawn(move||{
            thread::sleep(Duration::from_millis(65));
            // No call to finish_owner_verification: no positive HTTPS proof.
            bypass.inner.lock().unwrap().status_inflight=false;
        });
        assert!(!bounded_await(runtime.wall_snapshot_current_after_verification_with_budget(
            &snap,Duration::from_millis(480))));
        worker.join().unwrap();
    }

    #[test]
    fn t04b9c3b2_wall_snapshot_does_not_promote_signed_out_owner() {
        let runtime=OwnerRuntime::default();
        assert!(runtime.wall_snapshot().is_err());
    }
    #[test]
    fn t04b9c3b2_wall_owner_generation_and_refresh_fences() {
        let runtime=OwnerRuntime::default();
        {
            let mut s=runtime.inner.lock().unwrap();
            s.phase="verified".into();
            s.account_id=Some("acct_dev".into());
            s.access_token=Some("A".repeat(43));
            s.generation=5;
            s.last_verified=Some(Instant::now());
            s.access_deadline=Some(Instant::now()+Duration::from_secs(550));
        }
        let current=runtime.wall_snapshot().unwrap();
        assert!(runtime.wall_snapshot_current(&current));
        {
            let mut s=runtime.inner.lock().unwrap();
            s.status_inflight=true;
        }
        assert!(!runtime.wall_snapshot_current(&current));
        assert!(runtime.wall_snapshot().is_err());
        {
            let mut s=runtime.inner.lock().unwrap();
            s.status_inflight=false;
            s.generation=6;
        }
        assert!(!runtime.wall_snapshot_current(&current));
    }
    #[test]
    fn t04b9c3b2_wall_session_near_expiry_cannot_issue_ticket() {
        let runtime=OwnerRuntime::default();
        {
            let mut s=runtime.inner.lock().unwrap();
            s.phase="verified".into();
            s.account_id=Some("acct_dev".into());
            s.access_token=Some("A".repeat(43));
            s.access_deadline=Some(Instant::now()+Duration::from_secs(30));
        }
        assert!(runtime.wall_snapshot().is_err());
    }

    #[test]
    fn url_is_exact_account_desktop_not_mcp_or_wall() {
        let u=auth_url("http://127.0.0.1:49152/desktop/v4/callback",
            &"V".repeat(43),&"S".repeat(43),&"I".repeat(43)).unwrap();
        let parsed=Url::parse(&u).unwrap();
        assert_eq!(parsed.origin().ascii_serialization(),auth_origin());
        assert_eq!(parsed.path(),"/account/desktop/v4/authorize");
        assert!(!parsed.path().contains("/mcp"));
        assert!(u.contains("code_challenge_method=S256"));
        assert!(!u.contains("code_verifier"));
    }
    #[test]
    fn exact_pkce_and_callback_prevent_replay_and_redirect_spoof() {
        let state="S".repeat(43);
        let code="C".repeat(43);
        let success=format!("/desktop/v4/callback?code={}&state={}&iss=https%3A%2F%2Fgoldabv2.light-remote.thaiduy.digital",code,state);
        assert_eq!(validate_callback(&success,&state).unwrap(),code);
        for invalid in [
            success.replace("SSSS","TTTT"),
            success.replace("goldabv2.light-remote.thaiduy.digital","evil.example"),
            success.replace("/desktop/v4/callback","/desktop/v4/callback/extra"),
            format!("{}&code={}",success,code),
            format!("{}&state={}",success,state),
            format!("{}&extra=value",success),
            "/desktop/v4/callback?code=foo".into(),
            "/desktop/v4/callback#fragment".into()
        ] {
            assert!(validate_callback(&invalid,&state).is_err());
        }
    }
    #[test]
    fn explicit_consent_denial_is_not_success() {
        let state="S".repeat(43);
        let denied=format!("/desktop/v4/callback?error=access_denied&state={}&iss=https%3A%2F%2Fgoldabv2.light-remote.thaiduy.digital",state);
        assert_eq!(validate_callback(&denied,&state).unwrap_err(),"owner_consent_denied");
    }
    #[test]
    fn token_reply_must_be_exact_purpose_and_bounded() {
        let valid=json!({
            "token_type":"Bearer","scope":SCOPE,"resource":RESOURCE,
            "account_id":"owner1","access_token":"A".repeat(43),
            "refresh_token":"R".repeat(43),"expires_in":600
        });
        assert_eq!(check_token_set(valid.clone()).unwrap().expires_in,600);
        let mut invalid=valid.clone();invalid["scope"]=json!("remote:execute");
        assert!(check_token_set(invalid).is_err());
        let mut invalid=valid;invalid["expires_in"]=json!(86400);
        assert!(check_token_set(invalid).is_err());
    }
    #[test]
    fn generated_material_is_independent_random_base64url() {
        let a=secret();let b=secret();
        assert!(token_ok(&a));assert!(token_ok(&b));assert_ne!(a,b);
        assert!(token_ok(&challenge(&a)));
    }
    fn owner_with_deadline(deadline: Instant, last_verified: Option<Instant>) -> OwnerRuntime {
        let runtime=OwnerRuntime::default();
        {
            let mut s=runtime.inner.lock().unwrap();
            s.phase="verified".into();
            s.account_id=Some("owner1".into());
            s.access_token=Some("A".repeat(43));
            s.access_deadline=Some(deadline);
            s.last_verified=last_verified;
            s.generation=4;
        }
        runtime
    }
    fn mock_tokens(account: &str) -> TokenSet {
        TokenSet {
            access_token:"B".repeat(43),
            refresh_token:"R".repeat(43),
            account_id:account.into(),
            expires_in:600
        }
    }
    #[test]
    fn refresh_happens_before_expiry_and_after_sleep_resume() {
        let now=Instant::now();
        let runtime=owner_with_deadline(now+Duration::from_secs(600),Some(now));
        let mut s=runtime.inner.lock().unwrap();
        assert_eq!(next_owner_poll(&s,now),OwnerPoll::Idle);
        s.last_verified=Some(now-Duration::from_secs(16));
        assert_eq!(next_owner_poll(&s,now),OwnerPoll::Verify);
        s.access_deadline=Some(now+Duration::from_secs(89));
        assert_eq!(next_owner_poll(&s,now),OwnerPoll::Refresh);
        s.access_deadline=Some(now-Duration::from_secs(3600));
        assert_eq!(next_owner_poll(&s,now),OwnerPoll::Refresh);
        s.status_inflight=true;
        assert_eq!(next_owner_poll(&s,now),OwnerPoll::Idle);
        drop(s);
        // Concurrent polls cannot expose verified Owner during a rotation,
        // including wake-up after the old access token has expired.
        assert_eq!(runtime.view().unwrap().phase,"restoring");
    }
    #[test]
    fn native_refresh_commits_one_keyring_rotation_and_preserves_owner() {
        let now=Instant::now();
        let runtime=owner_with_deadline(now+Duration::from_secs(30),Some(now));
        runtime.inner.lock().unwrap().status_inflight=true;
        let mut writes=0;
        let revoked=finish_owner_refresh(&runtime,4,"owner1",Ok(mock_tokens("owner1")),|token|{
            assert_eq!(token.len(),43);
            writes+=1;
            Ok(())
        });
        assert!(revoked.is_none());
        assert_eq!(writes,1);
        assert_eq!(runtime.view().unwrap().phase,"verified");
        let s=runtime.inner.lock().unwrap();
        assert_eq!(s.access_token.as_deref(),Some("B".repeat(43).as_str()));
        assert!(s.access_deadline.unwrap()>now+Duration::from_secs(500));
        assert_eq!(next_owner_poll(&s,Instant::now()),OwnerPoll::Idle);
    }
    #[test]
    fn signout_during_refresh_never_persists_a_late_token() {
        let now=Instant::now();
        let runtime=owner_with_deadline(now+Duration::from_secs(5),Some(now));
        {
            let mut s=runtime.inner.lock().unwrap();
            s.status_inflight=true;
            s.generation+=1;
            s.phase="signed_out".into();
            s.account_id=None;
            s.access_token=None;
            s.status_inflight=false;
        }
        let mut writes=0;
        let revoked=finish_owner_refresh(&runtime,4,"owner1",Ok(mock_tokens("owner1")),|_|{
            writes+=1;Ok(())
        });
        assert!(revoked.is_some());
        assert_eq!(writes,0);
        assert_eq!(runtime.view().unwrap().phase,"signed_out");
    }
    #[test]
    fn cold_restore_after_explicit_signout_shows_welcome_not_session_expired() {
        // The OS vault returned NoEntry after Sign out. No HTTPS attempt is
        // needed and neither a token nor a verified Owner can reappear.
        let runtime=OwnerRuntime::default();
        let generation=runtime.transition("restoring").unwrap();
        runtime.finish(generation,Err("owner_not_signed_in".into()));
        let view=runtime.view().unwrap();
        assert_eq!(view.phase,"signed_out");
        assert_eq!(view.account_id,None);
        let s=runtime.inner.lock().unwrap();
        assert!(s.access_token.is_none());
        assert!(s.access_deadline.is_none());
        assert!(!s.status_inflight);
    }

    #[test]
    fn restore_network_rejection_and_inaccessible_vault_still_fail_closed() {
        for error in [
            "owner_https_unavailable",
            "owner_authorization_rejected",
            "os_vault_read_failed",
            "os_vault_credential_invalid"
        ] {
            let runtime=OwnerRuntime::default();
            let generation=runtime.transition("restoring").unwrap();
            runtime.finish(generation,Err(error.into()));
            assert_eq!(runtime.view().unwrap().phase,"expired", "{error}");
        }
    }

    #[test]
    fn browser_flow_cannot_treat_missing_vault_as_a_valid_signout() {
        let runtime=OwnerRuntime::default();
        let generation=runtime.transition("browser_pending").unwrap();
        runtime.finish(generation,Err("owner_not_signed_in".into()));
        assert_eq!(runtime.view().unwrap().phase,"expired");
    }

    #[test]
    fn stale_restore_callback_cannot_overwrite_new_signout() {
        let runtime=OwnerRuntime::default();
        let previous=runtime.transition("restoring").unwrap();
        {
            let mut s=runtime.inner.lock().unwrap();
            s.generation=s.generation.wrapping_add(1);
            s.phase="signed_out".into();
        }
        runtime.finish(previous,Err("owner_not_signed_in".into()));
        assert_eq!(runtime.view().unwrap().phase,"signed_out");
    }

    #[test]
    fn refresh_failure_wrong_owner_or_locked_vault_fails_closed() {
        let now=Instant::now();
        for case in 0..3 {
            let runtime=owner_with_deadline(now-Duration::from_secs(30),Some(now));
            runtime.inner.lock().unwrap().status_inflight=true;
            let result=match case {
                0=>Err("owner_https_unavailable".into()),
                1=>Ok(mock_tokens("different-owner")),
                _=>Ok(mock_tokens("owner1"))
            };
            let mut writes=0;
            let revoked=finish_owner_refresh(&runtime,4,"owner1",result,|_|{
                writes+=1;
                if case==2 {Err("os_vault_write_failed".into())}
                else {Ok(())}
            });
            assert_eq!(runtime.view().unwrap().phase,"expired");
            assert_eq!(writes,if case==2 {1} else {0});
            assert_eq!(revoked.is_some(),case!=0);
            assert_eq!(runtime.inner.lock().unwrap().access_token,None);
        }
    }
    #[test]
    fn session_revalidation_revocation_and_stale_result_are_fenced() {
        let now=Instant::now();
        let runtime=owner_with_deadline(now+Duration::from_secs(300),
            Some(now-Duration::from_secs(20)));
        runtime.inner.lock().unwrap().status_inflight=true;
        finish_owner_verification(&runtime,4,&"A".repeat(43),false);
        assert_eq!(runtime.view().unwrap().phase,"expired");
        let later=owner_with_deadline(now+Duration::from_secs(300),Some(now));
        {
            let mut s=later.inner.lock().unwrap();
            s.status_inflight=true;
            s.generation=5;
        }
        finish_owner_verification(&later,4,&"A".repeat(43),false);
        assert_eq!(later.view().unwrap().phase,"verified");
        assert!(later.inner.lock().unwrap().status_inflight);
    }
}
