const preferred=['Windows','Linux','macOS','Other / Unknown'];
export function deviceOSSummary(accountsData={}){
 const devices=(Array.isArray(accountsData.accounts)?accountsData.accounts:[]).flatMap(a=>Array.isArray(a.devices)?a.devices:[]);
 const unique=new Map();
 for(const d of devices){if(d?.deviceId)unique.set(String(d.deviceId),d)}
 const totals=Object.fromEntries(preferred.map(x=>[x,{name:x,total:0,online:0,offline:0,arch:{}}]));
 for(const d of unique.values()){
  const osRaw=String(d.platform||'').toLowerCase();
  const key=/^(win32|windows|win64)$/.test(osRaw)?'Windows':/^(linux)$/.test(osRaw)?'Linux':/^(darwin|macos|mac|osx)$/.test(osRaw)?'macOS':'Other / Unknown';
  const row=totals[key];
  row.total++;
  if(String(d.state).toLowerCase()==='online')row.online++;
  else row.offline++;
  const arch=String(d.architecture||'unknown').toLowerCase();
  const archLabel=/^(arm64|aarch64)$/.test(arch)?'arm64':/^(x64|amd64|x86_64)$/.test(arch)?'x64':/^(x86|i386)$/.test(arch)?'x86':'unknown';
  row.arch[archLabel]=(row.arch[archLabel]||0)+1;
 }
 const rows=preferred.map(key=>totals[key]).filter(row=>row.total>0);
 const total=rows.reduce((sum,row)=>sum+row.total,0);
 const online=rows.reduce((sum,row)=>sum+row.online,0);
 const offline=total-online;
 return {ok:true,total,online,offline,os:rows,definition:'Registered device identities grouped by device registry platform; not page views, browser OS or downloaded applications.'};
}
