import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {FeatureScreen} from './FeatureScreens';
import {Overview,NativeApprovalRequest} from './WorkspaceViews';
import type {OwnerSnapshot} from './lib/native-snapshot';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function sample():OwnerSnapshot{return {state:'ready',accountId:'owner',asOf:Date.now(),account:{email:'person@example.test',plan:'pro',status:'active',emailVerified:true},entitlements:{plan:'pro',toolCallLimit:null},usage:{month:'2026-11',toolCallsThisMonth:12,byDevice:[]},devices:[{deviceId:'pc',name:'Design PC',shortId:'DESK22',os:'win32',state:'online',lastSeenAt:100}],sessions:[],grants:[],events:[{deviceId:'pc',eventType:'node_command_dispatched',status:'running',at:1000}],jobs:Array.from({length:120},(_,i)=>({jobId:'j-'+i,deviceId:'pc',agentId:'agent',sessionId:null,state:i%3===0?'error':i%3===1?'ok':'running',startedAt:120000-i*1000,finishedAt:null,exitCode:null})),coverage:{jobs:{returned:120,total:120,hasMore:false,source:'in_memory_current_window'}}};}
it('pastes an undashed B code without weakening its alphabet or native callback arguments',async()=>{
 const onApprove=vi.fn(async()=>true),request={requestId:'request',attempt:3,aCode:'DESK22-ABCDE',expiresAt:Date.now()+60000};
 render(<NativeApprovalRequest request={request} consentRequired={false} approving={false} onApprove={onApprove}/>);
 const input=screen.getByRole('textbox',{name:'Agent B code'}),button=screen.getByRole('button',{name:'Approve Agent'}) as HTMLButtonElement;
 fireEvent.change(input,{target:{value:'OOOO-OOOO'}});expect(button.disabled).toBe(true);
 fireEvent.change(input,{target:{value:'wew7nnbu'}});expect((input as HTMLInputElement).value).toBe('WEW7-NNBU');expect(button.disabled).toBe(false);
 fireEvent.click(button);expect(await screen.findByRole('status')).toHaveProperty('textContent','Agent approved. It can now connect to this device.');
 expect(onApprove).toHaveBeenCalledExactlyOnceWith(request,'WEW7-NNBU','');
});
it('bounds loaded task history, filters real statuses and keeps opaque IDs in collapsed details',()=>{
 render(<FeatureScreen route="live-monitor" status={null} snapshot={sample()}/>);
 const table=screen.getByRole('region',{name:'Agent jobs'});
 expect(within(table).getAllByRole('row')).toHaveLength(11);
 expect(screen.queryByText('j-119')).toBeNull();
 expect(screen.getByText('Task started')).toBeTruthy();
 const raw=screen.getByText('node_command_dispatched');expect(raw.closest('details')?.open).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Needs attention'}));
 const status=Array.from(table.querySelectorAll('.product-badge')).map(x=>x.textContent);expect(status.length).toBeGreaterThan(0);expect(status.every(x=>x==='Failed')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'All tasks'}));fireEvent.change(screen.getByRole('searchbox',{name:'Find a task or device'}),{target:{value:'j-119'}});
 expect(within(table).getAllByRole('row')).toHaveLength(2);expect(screen.getByText('j-119')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Stop task'})).toBeNull();
});
it('separates current sessions from history while keeping authoritative totals',()=>{
 const snapshot=sample();const common={deviceId:'pc',agentId:'agent',createdAt:100,lastSeenAt:100,expiresAt:9000,holdReason:null,activeJobs:0};
 const data={...snapshot,sessions:[{...common,sessionId:'s-live',name:'Current agent',state:'active' as const},{...common,sessionId:'s-old',name:'Previous agent',state:'expired' as const}],coverage:{...snapshot.coverage!,sessions:{returned:2,total:20,hasMore:true,activeTotal:4,holdTotal:2,source:'in_memory_current_window' as const}}};
 render(<FeatureScreen route="sessions" status={null} snapshot={data}/>);
 expect(screen.getByText('Current agent')).toBeTruthy();expect(screen.queryByText('Previous agent')).toBeNull();
 expect(screen.getByText('4')).toBeTruthy();expect(screen.getByText('2')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'History'}));expect(screen.getByText('Previous agent')).toBeTruthy();expect(screen.queryByText('Current agent')).toBeNull();
 expect(screen.queryByRole('button',{name:'Close session'})).toBeNull();
});
it('uses actual pending requests and recent jobs on Overview rather than static waiting text',()=>{
 const navigate=vi.fn();render(<Overview status={{phase:'settled',result:{state:'ready',device:{verifiedAt:1,deviceName:'Design PC',connection:'connected',cloudState:'connected'}}}} navigate={navigate} wallProbe="unavailable" snapshot={sample()} abv2={{state:'ready',deviceId:'pc',shortId:'DESK22',ownerApproveEnabled:true,ownerConsentRequired:false,pending:[{requestId:'r1',attempt:1,aCode:null,expiresAt:Date.now()+10000}]}}/>);
 expect(screen.queryByText('Waiting for a signed request')).toBeNull();expect(screen.getByRole('heading',{name:'Recent work'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Review 1 request'}));expect(navigate).toHaveBeenCalledWith('ai-access');
});
it('does not turn an unknown allowance into an unlimited plan or a zero quota',()=>{
 render(<FeatureScreen route="account" status={null} snapshot={sample()}/>);
 expect(screen.getByText('Not provided')).toBeTruthy();expect(screen.queryByText(/Unlimited/i)).toBeNull();
 expect(screen.getByText('person@example.test')).toBeTruthy();
});
it('drops a previous account snapshot immediately when the current Owner changes',()=>{
 const view=render(<FeatureScreen route="account" status={null} snapshot={sample()} ownerAccountId="owner"/>);
 expect(screen.getByText('person@example.test')).toBeTruthy();
 view.rerender(<FeatureScreen route="account" status={null} snapshot={sample()} ownerAccountId="different-owner"/>);
 expect(screen.queryByText('person@example.test')).toBeNull();expect(screen.getByText('Account information unavailable')).toBeTruthy();
});
