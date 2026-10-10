import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../../plugin-server/account-portal/team.html',import.meta.url),'utf8');
const js=html.split('<script>').at(-1).split('</script>')[0];
const mailer=fs.readFileSync(new URL('../../plugin-server/mailer.mjs',import.meta.url),'utf8');
assert(mailer.includes("joinUrl=PUBLIC_ORIGIN+'/account/team#invite='+encodeURIComponent(inviteCode)"));
assert(mailer.includes("ctaLabel:'Review & accept invitation'"));
assert(html.includes('name="referrer" content="no-referrer"'));
assert(!html.includes('Member account ID'));
const code='A'.repeat(32), store=new Map();
let seats=1, accepted=false, actor='wrong@example.com', requests=[];
const storage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
const nodes=new Map();
function node(id){
 if(!nodes.has(id)){
   nodes.set(id,{value:'',textContent:'',innerHTML:'',options:[{value:1}],disabled:false,
     classList:{add(){},remove(){},toggle(){}},focus(){},
     addEventListener(){},dataset:{}});
 }
 return nodes.get(id);
}
async function run(hash,actorEmail){
 actor=actorEmail;
 const location={hash,pathname:'/account/team',search:'',href:'/account/team'};
 const state={lastReplaced:null};
 const history={state:null,replaceState(_data,_unused,path){state.lastReplaced=path;location.hash=''}};
 const fetch=async(url,options={})=>{
   const action=new URL('https://uat.example'+url).searchParams.get('action');
   requests.push({action,actor,method:options.method||'GET'});
   const data=action==='me'?{account:{email:actor,plan:'free',accountId:actor}}:
     action==='devices'?{devices:[]}:
     action==='team-memberships'?{memberships:seats===2&&actor==='invitee@example.com'?[{ownerAccountId:'owner',sharedDevices:[]}]:[]}:
     action==='team-view'?{error:'team_not_found'}:
     action==='team-accept'
       ?actor==='invitee@example.com'&&JSON.parse(options.body).inviteCode===code
         ?(accepted=true,seats=2,{ok:true}):{error:'team_invite_invalid'}
       :{error:'unexpected_action'};
   const status=(action==='team-view'?404:action==='team-accept'&&!accepted?403:200);
   return {ok:status===200,status,json:async()=>data};
 };
 const context={document:{getElementById:node},location,history,sessionStorage:storage,fetch,URL,URLSearchParams,
   navigator:{clipboard:{writeText:async()=>{}}},confirm:()=>true};
 vm.runInNewContext(js,context);
 await new Promise(resolve=>setTimeout(resolve,10));
 return {location,state};
}
const first=await run('#invite='+encodeURIComponent(code),'wrong@example.com');
assert.equal(first.state.lastReplaced,'/account/team');
assert.equal(first.location.hash,'');
assert.equal(node('acceptCode').value,code);
assert.equal(store.get('light_remote_team_pending_invite'),code);
assert.equal(accepted,false,'opening email link must not auto-accept');
assert.match(node('status').textContent,/wrong@example.com/);
node('accept').onclick();
await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(accepted,false,'wrong account must not accept');
assert.equal(store.get('light_remote_team_pending_invite'),code,'retain code for correct login');
const second=await run('','invitee@example.com');
assert.equal(node('acceptCode').value,code,'pending invitation survives login navigation');
assert.match(node('status').textContent,/invitee@example.com/);
node('accept').onclick();
await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(accepted,true);
assert.equal(seats,2);
assert.equal(store.has('light_remote_team_pending_invite'),false,'clear code after use');
assert.equal(node('acceptCode').value,'');
assert(requests.filter(x=>x.action==='team-accept').length===2);
console.log('pro_team_email_fragment_stripped_before_network=PASS');
console.log('pro_team_email_click_requires_confirm=PASS');
console.log('pro_team_wrong_account_rejected_and_code_retained=PASS');
console.log('pro_team_invite_survives_login_and_accept_updates_2_seats=PASS');
console.log('pro_team_invite_token_cleared_after_accept=PASS');
