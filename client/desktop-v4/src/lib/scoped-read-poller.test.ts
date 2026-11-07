/** T09-P02: actual async scheduler regression, no native Owner/Device grant. */
// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {startScopedReadPoller} from './scoped-read-poller';

type Reply={state:'ready'|'unavailable'; account:string;revision:number};
const ok=(account:string,revision:number):Reply=>({state:'ready',account,revision});
const unavailable=():Reply=>({state:'unavailable',account:'',revision:0});
const deferred=<T>()=>{
  let resolve!: (v:T)=>void;
  let reject!: (error:Error)=>void;
  const promise=new Promise<T>((res,rej)=>{resolve=res;reject=rej;});
  return {promise,resolve,reject};
};
let hidden=false;
beforeEach(()=>{
  vi.useFakeTimers();
  hidden=false;
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
});
afterEach(()=>{
  vi.useRealTimers();
  delete (document as unknown as Record<string,unknown>).hidden;
});
describe('Owner-scoped read backpressure',()=>{
  it('never overlaps a slow Owner snapshot even when the read exceeds 20s',async()=>{
    const pending=deferred<Reply>();
    const task=vi.fn().mockImplementationOnce(()=>pending.promise)
      .mockResolvedValue(ok('A',2));
    const apply=vi.fn();
    const poll=startScopedReadPoller({intervalMs:20_000,task,apply,
      healthy:(v)=>v.state==='ready',unavailable});
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(80_000);
    expect(task).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    pending.resolve(ok('A',1));
    await Promise.resolve();
    expect(apply).toHaveBeenCalledWith(ok('A',1));
    await vi.advanceTimersByTimeAsync(19_999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith(ok('A',2));
    poll.stop();
  });
  it('manual refresh after Approve invalidates older pending preview and queues exactly one re-read',async()=>{
    const stale=deferred<Reply>(),fresh=deferred<Reply>();
    const task=vi.fn().mockImplementationOnce(()=>stale.promise)
      .mockImplementationOnce(()=>fresh.promise);
    const apply=vi.fn();
    const poll=startScopedReadPoller({intervalMs:8000,task,apply,
      healthy:(v)=>v.state==='ready',unavailable});
    poll.refreshNow();
    poll.refreshNow(); // multiple refresh intents coalesce, never duplicate grant
    expect(task).toHaveBeenCalledTimes(1);
    stale.resolve(ok('A',1));
    await Promise.resolve();
    await Promise.resolve();
    expect(apply).not.toHaveBeenCalled();
    expect(task).toHaveBeenCalledTimes(2);
    fresh.resolve(ok('A',2));
    await Promise.resolve();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(ok('A',2));
    poll.stop();
  });
  it('Owner change/unmount closes old generation and prevents late Owner A from rendering in B',async()=>{
    const slow=deferred<Reply>();
    const aApply=vi.fn(),bApply=vi.fn();
    const a=startScopedReadPoller({intervalMs:20_000,task:()=>slow.promise,
      apply:aApply,healthy:(v)=>v.state==='ready',unavailable});
    a.stop();
    const b=startScopedReadPoller({intervalMs:20_000,
      task:async()=>ok('B',3),apply:bApply,
      healthy:(v)=>v.state==='ready',unavailable});
    await Promise.resolve();
    slow.resolve(ok('A',9));
    await Promise.resolve();
    expect(aApply).not.toHaveBeenCalled();
    expect(bApply).toHaveBeenCalledWith(ok('B',3));
    expect(vi.getTimerCount()).toBe(1);
    b.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('hidden UI drops a late read and on visibility resumes one fresh read',async()=>{
    const slow=deferred<Reply>();
    const apply=vi.fn(),task=vi.fn().mockImplementationOnce(()=>slow.promise)
      .mockResolvedValue(ok('A',2));
    const poll=startScopedReadPoller({intervalMs:8000,task,apply,
      healthy:(v)=>v.state==='ready',unavailable});
    hidden=true;document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(200_000);
    expect(task).toHaveBeenCalledTimes(1);
    slow.resolve(ok('A',1));
    await Promise.resolve();
    expect(apply).not.toHaveBeenCalled();
    hidden=false;document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledWith(ok('A',2));
    poll.stop();
  });
  it('an unavailable Owner read fails closed and backs off, then resets after healthy proof',async()=>{
    const task=vi.fn().mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(ok('A',1))
      .mockRejectedValueOnce(Error('network'));
    const apply=vi.fn();
    const poll=startScopedReadPoller({intervalMs:8000,task,apply,
      healthy:(v)=>v.state==='ready',unavailable});
    await Promise.resolve();await Promise.resolve();
    expect(apply).toHaveBeenCalledWith(unavailable());
    await vi.advanceTimersByTimeAsync(15999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(8000);
    expect(task).toHaveBeenCalledTimes(3);
    expect(apply).toHaveBeenLastCalledWith(unavailable());
    poll.stop();
  });
});
