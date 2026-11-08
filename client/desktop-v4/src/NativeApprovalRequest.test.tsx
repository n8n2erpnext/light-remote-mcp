import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NativeApprovalRequest } from './App';
import { nativeAbv2Approve, type NativeAbv2Request } from './lib/native-abv2';

const REQUEST: NativeAbv2Request = {
  requestId: 'av2_' + 'a'.repeat(32),
  attempt: 2,
  expiresAt: 1799999999999,
  aCode: null
};

type Host = Window & {
  __TAURI_INTERNALS__?: {
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
};

async function approve(
  request: NativeAbv2Request, bCode: string, consentCode: string
): Promise<boolean> {
  return (await nativeAbv2Approve(request, bCode, consentCode)).state === 'granted';
}

beforeEach(() => {
  vi.stubEnv('VITE_LR_V4_OWNER_LOGIN', '1');
  vi.stubEnv('VITE_LR_V4_ABV2_NATIVE', '1');
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Unexpected browser HTTP'); }));
});

afterEach(() => {
  cleanup();
  delete (window as Host).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Desktop Owner approval form to same-host native Agent boundary', () => {
  it('submits a typed B-only code through the exact private Tauri command', async () => {
    const invoke = vi.fn(async () => ({
      state: 'granted', requestId: REQUEST.requestId,
      expiresAt: 1799999999999, secret: 'MUST_NOT_RENDER'
    }));
    (window as Host).__TAURI_INTERNALS__ = { invoke };
    render(<NativeApprovalRequest request={REQUEST} consentRequired={false}
      approving={false} onApprove={approve} />);
    const submit = screen.getByRole('button', { name: 'Approve Agent' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Agent B code' }), {
      target: { value: 'wew7-nnbu' }
    });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(await screen.findByRole('status')).toHaveProperty('textContent',
      'Approved by the enrolled Agent and Operator.');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('desktop_owner_abv2_approve', {
      requestId: REQUEST.requestId,
      expectedAttempt: 2,
      bCode: 'WEW7-NNBU',
      consentCode: ''
    });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('MUST_NOT_RENDER');
  });

  it('requires valid Owner consent when the Agent reports consent-required', async () => {
    const invoke = vi.fn(async () => ({
      state: 'granted', requestId: REQUEST.requestId, expiresAt: null
    }));
    (window as Host).__TAURI_INTERNALS__ = { invoke };
    render(<NativeApprovalRequest request={REQUEST} consentRequired
      approving={false} onApprove={approve} />);
    const submit = screen.getByRole('button', { name: 'Approve Agent' }) as HTMLButtonElement;
    fireEvent.change(screen.getByRole('textbox', { name: 'Agent B code' }), {
      target: { value: 'WEW7-NNBU' }
    });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Owner consent code' }), {
      target: { value: 'A'.repeat(32) }
    });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('desktop_owner_abv2_approve', {
      requestId: REQUEST.requestId,
      expectedAttempt: 2,
      bCode: 'WEW7-NNBU',
      consentCode: 'A'.repeat(32)
    });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('fails closed on native IPC refusal, without presenting a grant', async () => {
    const invoke = vi.fn(async () => { throw Error('Owner or Agent unavailable'); });
    (window as Host).__TAURI_INTERNALS__ = { invoke };
    render(<NativeApprovalRequest request={REQUEST} consentRequired={false}
      approving={false} onApprove={approve} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Agent B code' }), {
      target: { value: 'WEW7-NNBU' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Approve Agent' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent',
      'Approval unavailable or expired. Refresh the request and try again.');
    expect(screen.queryByText('Approved by the enrolled Agent and Operator.')).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
