import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {CodexControls,CodexLoginCode} from './CodexControls';
import {projectCodexSession} from './lib/codex-session';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('Codex user controls',()=>{
 it('provides selectable read-only sign-in code and an explicit clipboard action',async()=>{
  const writeText=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
  render(<CodexLoginCode code="CODE-TEST" pending={false} onCancel={()=>{}}/>);
  const input=screen.getByRole('textbox',{name:'Codex sign-in code'}) as HTMLInputElement;
  expect(input.readOnly).toBe(true);fireEvent.focus(input);expect(input.selectionStart).toBe(0);expect(input.selectionEnd).toBe(9);
  fireEvent.click(screen.getByRole('button',{name:'Copy code'}));await screen.findByRole('button',{name:'Copied'});expect(writeText).toHaveBeenCalledWith('CODE-TEST');
 });
 it('renders only catalog reasoning options and reported token/quota values',()=>{
  const session=projectCodexSession({account:{state:'ready',connected:true,plan:'plus'},catalog:{state:'ready',models:[{model:'fixture-a',displayName:'Fixture A',defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high',description:'Careful'},{reasoningEffort:'max',description:'More'}]}]},selection:{model:'fixture-a',reasoningEffort:'high'},quota:{state:'ready',buckets:[{id:'fixture',name:'Fixture quota',primary:{usedPercent:37,windowDurationMins:300,resetsAt:1900000000}}]},accountUsage:{state:'unavailable'},usage:{state:'not_reported'}});
  const select=vi.fn();render(<CodexControls session={session} pending={false} onSelect={select} onRefresh={()=>{}}/>);
  expect(screen.getByText('37% used')).toBeTruthy();expect(screen.getByText('63% remaining')).toBeTruthy();
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('63');expect(screen.getByText('Account lifetime · reported by Codex').parentElement?.textContent).toContain('Not reported');
  fireEvent.change(screen.getByRole('combobox',{name:'Codex reasoning effort'}),{target:{value:'max'}});expect(select).toHaveBeenCalledWith('fixture-a','max');
  expect(screen.queryByRole('option',{name:'medium'})).toBeNull();
 });
 it('ignores a lingering login code when the verified account is already connected',()=>{
  const session=projectCodexSession({account:{state:'ready',connected:true},login:{state:'pending',userCode:'STALE-CODE'},catalog:{state:'not_checked'},selection:{},quota:{state:'not_checked'},accountUsage:{state:'not_checked'},usage:{state:'not_reported'}});
  expect(session?.login).toBeNull();expect(session?.usage.total).toBeNull();
 });
 it('keeps known fields from a partial token report without inventing total or reasoning tokens',()=>{
  const session=projectCodexSession({account:{state:'ready',connected:true},catalog:{state:'not_checked'},quota:{state:'unavailable'},accountUsage:{state:'unavailable'},usage:{state:'partial',total:{inputTokens:17,outputTokens:4},last:{outputTokens:4}}});
  expect(session?.usage.total?.inputTokens).toBe(17);expect(session?.usage.total?.totalTokens).toBeNull();expect(session?.usage.total?.reasoningOutputTokens).toBeNull();
  render(<CodexControls session={session} pending={false} onSelect={()=>{}} onRefresh={()=>{}}/>);
  expect(screen.getByText('17')).toBeTruthy();expect(screen.getByText(/Partial token report/)).toBeTruthy();
 });
});
