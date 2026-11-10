//! Fixed presentation assets from the same distribution source as web consent.
//! No callback query, code, state, Owner identity or token is rendered.
use std::{io::{Read,Write},net::{TcpListener,TcpStream},time::{Duration,Instant},thread};
pub(crate) const FONT_PATH:&str="/desktop/v4/assets/GoogleSans-Variable.ttf";
const FONT:&[u8]=include_bytes!("../../../../assets/fonts/web/GoogleSans-Variable.ttf");
const LOGO:&str=include_str!("../../../../assets/branding/light-remote-mark.svg");
const CSS:&str=include_str!("../../../../assets/branding/auth-pages.css");
const CSP:&str="default-src 'none'; font-src 'self'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
fn send(mut client:TcpStream,content_type:&str,status:&str,bytes:&[u8]){
 let _=client.set_nonblocking(false);
 let _=client.set_write_timeout(Some(Duration::from_secs(2)));
 let headers=format!("HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: {CSP}\r\nConnection: close\r\nContent-Length: {}\r\n\r\n",bytes.len());
 if client.write_all(headers.as_bytes()).is_ok(){let _=client.write_all(bytes);}
}
pub(crate) fn html(ok:bool)->String{
 let (title,text,symbol,state)=if ok{
  ("Return to Light Remote", "Your sign-in response was received. Desktop is checking it and will update automatically. You can close this browser tab.","✓","")
 }else{
  ("This request was not accepted", "Return to Light Remote Desktop and start sign-in again. This page has not signed you in.","!","error")
 };
 format!("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{title} · Light Remote</title><style>@font-face{{font-family:'Google Sans';src:url('{FONT_PATH}') format('truetype');font-weight:300 800;font-display:swap}}{CSS}</style></head><body><main class=\"consent-wrap\"><div class=\"brand\">{LOGO}<span>Light Remote</span></div><section class=\"consent-card\"><div class=\"callback-state {state}\" aria-hidden=\"true\">{symbol}</div><h1>{title}</h1><p role=\"status\">{text}</p></section><p class=\"footnote\">Only continue sign-in that you started in Light Remote Desktop.</p></main></body></html>")
}
pub(crate) fn respond(client:TcpStream,ok:bool){send(client,"text/html; charset=utf-8","200 OK",html(ok).as_bytes());}
pub(crate) fn font(client:TcpStream){send(client,"font/ttf","200 OK",FONT);}
// A completed callback no longer accepts OAuth messages. Briefly retain only
// the fixed public font asset so the offline loopback page can finish loading.
pub(crate) fn finish_assets(listener:TcpListener,port:u16){
 thread::spawn(move||{
  let deadline=Instant::now()+Duration::from_secs(10);
  while Instant::now()<deadline{
   match listener.accept(){
    Ok((mut client,_))=>{
     let _=client.set_nonblocking(false);
     let _=client.set_read_timeout(Some(Duration::from_millis(500)));
     let mut bytes=[0;4096];let n=client.read(&mut bytes).unwrap_or(0);
     let request=std::str::from_utf8(&bytes[..n]).unwrap_or("");
     if valid_font_request(request,port){font(client);}else{send(client,"text/plain; charset=utf-8","404 Not Found",b"Not found");}
    },
    Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>thread::sleep(Duration::from_millis(20)),
    Err(_)=>break
   }
  }
 });
}
fn valid_font_request(raw:&str,port:u16)->bool{
 let mut lines=raw.split("\r\n");
 let first=format!("GET {FONT_PATH} HTTP/1.1");
 if lines.next()!=Some(first.as_str()){return false;}
 let hosts:Vec<_>=lines.filter_map(|line|line.split_once(':')).filter(|(k,_)|k.eq_ignore_ascii_case("host")).map(|(_,v)|v.trim()).collect();
 hosts.len()==1&&hosts[0]==format!("127.0.0.1:{port}")
}
#[cfg(test)] mod tests{
 use super::*;
 #[test]fn canonical_branded_callback_does_not_claim_token_exchange_success(){
  let page=html(true);assert!(page.contains(LOGO));assert!(page.contains("Desktop is checking"));assert!(page.contains("Google Sans"));assert!(page.contains(CSS));
  assert!(!page.contains("Sign-in complete"));assert!(html(false).contains("has not signed you in"));assert!(FONT.len()>100000);
 }
 #[test]fn asset_server_rejects_other_paths_hosts_and_duplicate_host(){
  let valid=format!("GET {FONT_PATH} HTTP/1.1\r\nHost: 127.0.0.1:49152\r\n\r\n");
  assert!(valid_font_request(&valid,49152));assert!(!valid_font_request(&valid,49153));
  assert!(!valid_font_request(&valid.replace(FONT_PATH,"/desktop/v4/callback?code=secret"),49152));
  assert!(!valid_font_request(&valid.replace("\r\n\r\n","\r\nHost: evil.invalid\r\n\r\n"),49152));
 }
}
