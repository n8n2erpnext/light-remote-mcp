import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {useOwnerInventory} from './use-owner-inventory';
import {nativeOwnerInventoryPage} from './native-inventory';

vi.mock('./native-inventory',()=>({
  nativeOwnerInventoryAvailable:()=>true,
  nativeOwnerInventoryPage:vi.fn()
}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const data=(suffix:string,cursor:string|null,total:number)=>({
 state:'ready' as const,accountId:'owner',kind:'devices' as const,asOf:1000,
 rows:[{deviceId:'dev-'+suffix,name:'Device '+suffix,shortId:'R01KAP',
  os:'linux',state:'online',lastSeenAt:1000}],
 coverage:{returned:1,total,hasMore:cursor!==null,nextCursor:cursor,
  source:'owner_live_membership_revision' as const}
});
function Inventory({accountId}:{accountId:string|null}){
 const state=useOwnerInventory('devices',accountId);
 return <div>
  <span data-testid="inventory-count">{state.loaded}/{state.total??'?'}</span>
  <span data-testid="inventory-error">{state.error||''}</span>
  <ul>{state.rows.map(row=><li key={row.deviceId}>{row.deviceId}</li>)}</ul>
  {state.hasMore&&<button onClick={()=>void state.loadMore()} disabled={state.pending}>Load more</button>}
 </div>;
}
describe('Owner pages only append current valid cursor and never stale Owner state',()=>{
 it('fetches and appends two pages without overlapping the native invocation',async()=>{
  vi.mocked(nativeOwnerInventoryPage)
   .mockResolvedValueOnce(data('a','nextCursor_A',2))
   .mockResolvedValueOnce(data('b',null,2));
  render(<Inventory accountId="owner"/>);
  await waitFor(()=>expect(screen.getByTestId('inventory-count').textContent).toBe('1/2'));
  fireEvent.click(screen.getByRole('button',{name:'Load more'}));
  await waitFor(()=>expect(screen.getByTestId('inventory-count').textContent).toBe('2/2'));
  expect(screen.queryByRole('button',{name:'Load more'})).toBeNull();
  expect(vi.mocked(nativeOwnerInventoryPage)).toHaveBeenNthCalledWith(2,'owner','devices','nextCursor_A');
 });
 it('rejects a failed/stale next page without mutating trusted visible rows',async()=>{
  vi.mocked(nativeOwnerInventoryPage)
   .mockResolvedValueOnce(data('a','nextCursor_A',2))
   .mockResolvedValueOnce({state:'unavailable',reason:'cursor_stale'});
  render(<Inventory accountId="owner"/>);
  await waitFor(()=>expect(screen.getByTestId('inventory-count').textContent).toBe('1/2'));
  fireEvent.click(screen.getByRole('button',{name:'Load more'}));
  await waitFor(()=>expect(screen.getByTestId('inventory-error').textContent).toContain('Inventory changed'));
  expect(screen.getByTestId('inventory-count').textContent).toBe('1/2');
 });
 it('invalidates in-flight response when Owner changes',async()=>{
  let release!: (v:ReturnType<typeof data>)=>void;
  vi.mocked(nativeOwnerInventoryPage)
   .mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}))
   .mockResolvedValueOnce({state:'unavailable',reason:'owner_invalid'});
  const view=render(<Inventory accountId="owner"/>);
  view.rerender(<Inventory accountId="other"/>);
  release(data('old',null,1));
  await waitFor(()=>expect(screen.getByTestId('inventory-count').textContent).toBe('0/?'));
  expect(screen.queryByText('dev-old')).toBeNull();
 });
});
