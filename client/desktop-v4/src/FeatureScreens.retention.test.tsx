import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import type {OwnerSnapshot} from './lib/native-snapshot';
vi.mock('./lib/use-owner-activity',()=>({
 useOwnerActivity:()=>({
  pages:[{state:'ready',kind:'sessions',accountId:'owner',asOf:1794000000000,
   rows:[{sessionId:'s-retained',deviceId:'dev-a',agentId:'agent-1',name:'Retained',
    state:'closed',createdAt:100,lastSeenAt:101,expiresAt:null,holdReason:null,activeJobs:0}],
   coverage:{returned:1,total:1,hasMore:false,nextCursor:null,
    source:'redis_retained_session_window',
    retention:{snapshotTtlSeconds:604800,terminalPruneAfterMs:86400000,immutableAudit:false}}}],
  rows:[{sessionId:'s-retained',deviceId:'dev-a',agentId:'agent-1',name:'Retained',
   state:'closed',createdAt:100,lastSeenAt:101,expiresAt:null,holdReason:null,activeJobs:0}],
  total:1,loaded:1,hasMore:false,pending:false,error:null,loadMore:vi.fn()
 })
}));
import {FeatureScreen} from './FeatureScreens';
afterEach(cleanup);
it('H3 shows Redis TTL and terminal prune separately; never labels recovered sessions immutable',()=>{
 const snapshot={
  state:'ready',accountId:'owner',asOf:1000,
  account:{email:'owner@example.test',plan:'pro',status:'active',emailVerified:true},
  entitlements:{plan:'pro',toolCallLimit:500},
  usage:{month:'2026-11',toolCallsThisMonth:0,byDevice:[]},
  devices:[{deviceId:'dev-a',name:'Workstation',shortId:'R01KAP',os:'windows',state:'online',lastSeenAt:100}],
  sessions:[],grants:[],jobs:[],events:[],
  coverage:{jobs:{returned:0,total:0,hasMore:false,source:'in_memory_current_window'},
   sessions:{returned:0,total:0,hasMore:false,activeTotal:0,holdTotal:0,
    source:'in_memory_current_window'}}
 } as unknown as OwnerSnapshot;
 render(<FeatureScreen route="sessions" status={null}
  snapshot={snapshot} ownerAccountId="owner"/>);
 expect(screen.getByText(/Redis snapshot TTL: 7 days/)).toBeTruthy();
 expect(screen.getByText(/Terminal sessions are pruned after 1 days/)).toBeTruthy();
 expect(screen.getByText(/Not an immutable audit archive/)).toBeTruthy();
 expect(screen.getByText('Retained')).toBeTruthy();
 expect(screen.queryByText(/Permanent audit/)).toBeNull();
});
