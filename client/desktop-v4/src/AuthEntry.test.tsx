import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {AuthEntry} from './AuthEntry';

afterEach(()=>cleanup());

describe('V4 Owner Login gate: UI preview vs feature-enabled native browser flow',()=>{
  it('keeps Continue in browser disabled in ordinary UI pilot',()=>{
    render(<AuthEntry allowDesignPreview={false} onPreviewWorkspace={()=>{}} />);
    expect((screen.getByRole('button',{name:'Continue in browser'}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
  it('fires only a trusted native Owner begin callback with no user credentials',()=>{
    const begin=vi.fn();
    render(<AuthEntry allowDesignPreview={false} onPreviewWorkspace={()=>{}}
      nativePhase="signed_out" onBrowserSignIn={begin} />);
    const button=screen.getByRole('button',{name:'Continue in browser'});
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(begin.mock.calls[0]).toHaveLength(0);
    expect(screen.getByText(/Agent A\/B access stays separate/)).toBeTruthy();
  });
  it('shows a waiting callback state and explicit cancel, without any Owner grant',()=>{
    const cancel=vi.fn();
    render(<AuthEntry allowDesignPreview={false} onPreviewWorkspace={()=>{}}
      nativePhase="browser_pending" onBrowserSignIn={()=>{}} onCancelSignIn={cancel} />);
    expect(screen.getByRole('heading',{name:'Awaiting secure sign-in'})).toBeTruthy();
    expect(screen.getByText('Waiting for verified browser callback')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Cancel sign-in'}));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('explicit Sign out followed by cold restart shows normal Welcome, not SESSION EXPIRED',()=>{
    const begin=vi.fn();
    render(<AuthEntry allowDesignPreview={false} onPreviewWorkspace={()=>{}}
      nativePhase="signed_out" onBrowserSignIn={begin} />);
    expect(screen.getByRole('heading',{name:'Welcome to Light Remote'})).toBeTruthy();
    expect(screen.queryByText('SESSION EXPIRED')).toBeNull();
    expect(screen.queryByRole('heading',{name:'Sign in again to continue'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Continue in browser'}));
    expect(begin).toHaveBeenCalledTimes(1);
  });
  it('expired browser state offers a new sign in rather than an unlocked workspace',()=>{
    const begin=vi.fn();
    render(<AuthEntry allowDesignPreview={false} onPreviewWorkspace={()=>{}}
      nativePhase="expired" onBrowserSignIn={begin} />);
    expect(screen.getByRole('heading',{name:'Sign in again to continue'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Sign in again'}));
    expect(begin).toHaveBeenCalledTimes(1);
  });
});
