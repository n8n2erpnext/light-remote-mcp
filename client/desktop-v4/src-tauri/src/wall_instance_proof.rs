//! Windows native-only Local Wall proof. Neither Owner tokens nor B grants are
//! sent to the HTTP Wall; the key lives in the current user's private Agent
//! profile, not the renderer or an ambient web origin.
use rand::{rngs::OsRng,RngCore};
use sha2::{Digest,Sha256};
use std::{
    fs,io::{Read,Write},net::TcpStream,path::PathBuf,time::Duration,
};

const DOMAIN:&str="lr-goldabv2-wall-v1";
const PRODUCT:&str="goldabv2-desktop-v4";
const PROFILE:&str="goldabv2-lab";

fn from_hex(hex:&str)->Option<Vec<u8>>{
    if hex.len()%2!=0||hex.is_empty()||!hex.as_bytes().iter().all(|x|
        x.is_ascii_digit()||(*x>=b'a'&&*x<=b'f')){return None;}
    let bytes=hex.as_bytes();
    let mut out=Vec::with_capacity(bytes.len()/2);
    for i in (0..bytes.len()).step_by(2){
        let pair=std::str::from_utf8(&bytes[i..i+2]).ok()?;
        out.push(u8::from_str_radix(pair,16).ok()?);
    }
    Some(out)
}
fn to_hex(bytes:&[u8])->String{
    bytes.iter().map(|b|format!("{:02x}",b)).collect::<String>()
}
fn mac(key:&[u8],message:&[u8])->Option<[u8;32]>{
    if key.len()!=32{return None;}
    let mut ipad=[0x36u8;64];
    let mut opad=[0x5cu8;64];
    for (i,k) in key.iter().enumerate(){
        ipad[i]^=*k;opad[i]^=*k;
    }
    let mut inner=Sha256::new();
    inner.update(ipad);
    inner.update(message);
    let inner_hash=inner.finalize();
    let mut outer=Sha256::new();
    outer.update(opad);
    outer.update(inner_hash);
    Some(outer.finalize().into())
}
fn key_file()->Option<PathBuf>{
    let profile=std::env::var_os("USERPROFILE")?;
    let home=PathBuf::from(profile);
    if !home.is_absolute(){return None;}
    Some(home.join(".config").join("gpt-operator-agent-goldabv2")
        .join("wall-instance.key"))
}
pub(crate) fn verify()->bool{
    (||->Option<bool>{
        let key=fs::read_to_string(key_file()?).ok()?;
        let key=from_hex(key.trim())?;
        if key.len()!=32{return None;}
        let path=crate::endpoint_config::route("wallInstanceProof").ok()?;
        let parsed=url::Url::parse(path).ok()?;
        if parsed.scheme()!="http"||parsed.host_str()!=Some("127.0.0.1")||
            parsed.query().is_some()||parsed.fragment().is_some(){return None;}
        let addr=crate::endpoint_config::local_socket("wall").ok()?;
        if parsed.port_or_known_default()!=Some(addr.port()){return None;}
        let mut nonce_bytes=[0u8;32];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce=to_hex(&nonce_bytes);
        let request=format!(
            "GET {}?nonce={} HTTP/1.1\r\nHost: {}:{}\r\nAccept: application/json\r\nConnection: close\r\n\r\n",
            parsed.path(),nonce,parsed.host_str()?,addr.port()
        );
        let mut socket=TcpStream::connect_timeout(&addr,Duration::from_millis(600)).ok()?;
        socket.set_read_timeout(Some(Duration::from_millis(600))).ok()?;
        socket.set_write_timeout(Some(Duration::from_millis(600))).ok()?;
        socket.write_all(request.as_bytes()).ok()?;
        let mut bytes=Vec::new();
        socket.take(4096).read_to_end(&mut bytes).ok()?;
        let response=std::str::from_utf8(&bytes).ok()?;
        let (headers,body)=response.split_once("\r\n\r\n")?;
        if !(headers.starts_with("HTTP/1.1 200 ")||
             headers.starts_with("HTTP/1.0 200 ")){return None;}
        let value:serde_json::Value=serde_json::from_str(body).ok()?;
        if value["ok"].as_bool()!=Some(true)||
            value["productId"].as_str()!=Some(PRODUCT)||
            value["profile"].as_str()!=Some(PROFILE)||
            value["configRevision"].as_u64()!=Some(
                crate::endpoint_config::config_revision().ok()?){return None;}
        let pid=value["pid"].as_u64()?;
        if pid==0||pid>u32::MAX as u64{return None;}
        let supplied=from_hex(value["mac"].as_str()?)?;
        if supplied.len()!=32{return None;}
        let input=format!("{}\n{}\n{}\n{}\n{}\n{}",
            DOMAIN,nonce,pid,PRODUCT,PROFILE,
            crate::endpoint_config::config_revision().ok()?);
        let expected=mac(&key,input.as_bytes())?;
        let mut diff=0u8;
        for i in 0..32{diff|=supplied[i]^expected[i];}
        Some(diff==0)
    })().unwrap_or(false)
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test] fn node_hmac_sha256_vector_and_tamper(){
        let key=[0x11;32];
        let input=format!("{}\n{}\n4242\n{}\n{}\n2",
            DOMAIN,"aa".repeat(32),PRODUCT,PROFILE);
        let digest=mac(&key,input.as_bytes()).unwrap();
        assert_eq!(digest.len(),32);
        assert_eq!(to_hex(&digest),"f747cc842827747022d75f5a889c7a34e55db1deefd08e5a98b0757abe510329");
        assert_ne!(mac(&key,b"tampered").unwrap(),digest);
        assert_eq!(from_hex(&to_hex(&digest)).unwrap(),digest);
        assert!(from_hex(&"fg".repeat(32)).is_none());
    }
}
