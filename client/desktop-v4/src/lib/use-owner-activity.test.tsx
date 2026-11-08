import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {useOwnerActivity} from './use-owner-activity';
import {nativeOwnerActivityPage} from './native-activity';
vi.mock('./native-activity',()=>({nativeOwnerActivityPage:vi.fn()}));
vi.mock('./native-snapshot',()=>({nativeOwnerSnapshotAvailable:()=>true}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const page=(key:string,cursor:string|null,total:number)=>({
 state:'ready' as const,kind:'usage' as const,accountId:'owner',asOf:100,
 month:'2026-11',rows:[{deviceId:key,toolCalls:2,onlineMs:500}],
 coverage:{returned:1,total,hasMore:cursor!==null,nextCursor:cursor,
 source:'owner_current_month_usage' as const}
});
function Harness({owner}:{owner:string|null}){
 const a=useOwnerActivity('usage',owner);
 return <div>
  <span data-testid="count">{a.loaded}/{a.total??'?'}</span>
  <span data-testid="error">{a.error||''}</span>
  {a.rows.map(r=><span key={r.deviceId}>{r.deviceId}</span>)}
  {a.hasMore&&<button disabled={a.pending} onClick={()=>void a.loadMore()}>More</button>}
 </div>;
}
describe('F15 same-Owner typed page state',()=>{
 it('appends only unique pages without overlapping native invokes',async()=>{
  vi.mocked(nativeOwnerActivityPage)
   .mockResolvedValueOnce(page('dev-a','cursorNextA',2))
   .mockResolvedValueOnce(page('dev-b',null,2));
  render(<Harness owner="owner"/>);
  await waitFor(()=>expect(screen.getByTestId('count').textContent).toBe('1/2'));
  fireEvent.click(screen.getByRole('button',{name:'More'}));
  await waitFor(()=>expect(screen.getByTestId('count').textContent).toBe('2/2'));
  expect(vi.mocked(nativeOwnerActivityPage)).toHaveBeenNthCalledWith(2,
   'owner','usage','cursorNextA');
 });
 it('rejects replayed cursor and does not append duplicate row',async()=>{
  vi.mocked(nativeOwnerActivityPage)
   .mockResolvedValueOnce(page('dev-a','cursorNextA',2))
   .mockResolvedValueOnce(page('dev-a',null,2));
  render(<Harness owner="owner"/>);
  await waitFor(()=>expect(screen.getByTestId('count').textContent).toBe('1/2'));
  fireEvent.click(screen.getByRole('button',{name:'More'}));
  await waitFor(()=>expect(screen.getByTestId('error').textContent).toContain('Overlapping'));
  expect(screen.getByTestId('count').textContent).toBe('1/2');
 });
 it('drops prior Owner pending native response across account switch',async()=>{
  let resolve!:(x:ReturnType<typeof page>)=>void;
  vi.mocked(nativeOwnerActivityPage)
   .mockImplementationOnce(()=>new Promise(ok=>{resolve=ok;}))
   .mockResolvedValueOnce({state:'unavailable',reason:'denied'});
  const view=render(<Harness owner="owner"/>);
  view.rerender(<Harness owner="other"/>);
  resolve(page('old',null,1));
  await waitFor(()=>expect(screen.getByTestId('count').textContent).toBe('0/?'));
  expect(screen.queryByText('old')).toBeNull();
 });
});

describe('F15-H2 cross-source cursor fence',()=>{
 it('does not append a page after PG/Redis source type changes',async()=>{
  const first=page('dev-a','cursorNextA',2);
  const second={...page('dev-b',null,2),coverage:{
    ...page('dev-b',null,2).coverage,
    source:'in_memory_current_window' as const}};
  vi.mocked(nativeOwnerActivityPage)
   .mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  render(<Harness owner="owner"/>);
  await waitFor(()=>expect(screen.getByTestId('count').textContent).toBe('1/2'));
  fireEvent.click(screen.getByRole('button',{name:'More'}));
  await waitFor(()=>expect(screen.getByTestId('error').textContent)
   .toContain('Owner activity changed'));
  expect(screen.getByTestId('count').textContent).toBe('1/2');
 });
});
