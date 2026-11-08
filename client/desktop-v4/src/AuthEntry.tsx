import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, Fingerprint, LockKeyhole, ShieldCheck, ExternalLink, RotateCcw } from 'lucide-react';
import type { NativeOwnerPhase } from './lib/native-owner';
import './auth-entry.css';

export type AuthEntryMode =
  'signed-out' | 'browser-pending' | 'restoring' | 'app-lock' |
  'expired' | 'account-mismatch' | 'sign-out';

type Props = {
  allowDesignPreview: boolean;
  onPreviewWorkspace: () => void;
  // Native candidate only; the ordinary pilot never supplies these callbacks.
  nativePhase?: NativeOwnerPhase;
  onBrowserSignIn?: () => void;
  onCancelSignIn?: () => void;
};

const states: Record<Exclude<AuthEntryMode, 'signed-out'>, {
  label: string; title: string; description: string; note: string
}> = {
  'browser-pending': {
    label: 'BROWSER VERIFICATION',
    title: 'Awaiting secure sign-in',
    description: 'The system browser authenticates your account. The Desktop App must verify a one-time, server-issued result before opening the workspace.',
    note: 'No account callback is connected in this UI-only build.'
  },
  restoring: {
    label: 'RESTORE SESSION',
    title: 'Checking your saved session',
    description: 'A future signed-in app will use protected OS credential storage and verify the session with the server before unlocking.',
    note: 'This preview never reads or creates a saved credential.'
  },
  'app-lock': {
    label: 'LOCAL DEVICE LOCK',
    title: 'Unlock Light Remote',
    description: 'Unlock a previously signed-in app with Windows Hello, Touch ID or an available platform credential. Server revocation still takes priority.',
    note: 'Device unlock is a design specimen, not an implemented authenticator.'
  },
  expired: {
    label: 'SESSION EXPIRED',
    title: 'Sign in again to continue',
    description: 'Your account session may have expired or been revoked. Workspace screens stay locked until new verified account authorization.',
    note: 'Your enrolled device identity can remain stored without granting Agent access.'
  },
  'account-mismatch': {
    label: 'ACCOUNT MISMATCH',
    title: 'This is a different account',
    description: 'The verified account must match the device owner. Switching accounts must never transfer a linked device or approve A/B automatically.',
    note: 'Return to browser sign-in with the correct account.'
  },
  'sign-out': {
    label: 'SIGN-OUT REVIEW',
    title: 'Keep your device identity',
    description: 'Signing out revokes the app session and dependent Wall SSO. Device unlink and per-Agent A/B revocation remain separate Owner actions.',
    note: 'This is a UI-only state. No live server session is created or revoked.'
  }
};

const previews: { key: Exclude<AuthEntryMode, 'signed-out'>; label: string }[] = [
  { key: 'browser-pending', label: 'Browser pending' },
  { key: 'restoring', label: 'Restore session' },
  { key: 'app-lock', label: 'App Lock' },
  { key: 'expired', label: 'Expired' },
  { key: 'account-mismatch', label: 'Wrong account' },
  { key: 'sign-out', label: 'Sign out' }
];

export function AuthEntry({ allowDesignPreview, onPreviewWorkspace,
  nativePhase, onBrowserSignIn, onCancelSignIn }: Props) {
  const [previewMode, setPreviewMode] = useState<AuthEntryMode>('signed-out');
  const nativeLogin = typeof onBrowserSignIn === 'function';
  const mode: AuthEntryMode = nativeLogin
    ? nativePhase === 'browser_pending' ? 'browser-pending'
      : nativePhase === 'restoring' ? 'restoring'
      : nativePhase === 'expired' ? 'expired' : 'signed-out'
    : previewMode;
  const detail = mode === 'signed-out' ? null : states[mode];
  return (
    <div className="auth-shell" aria-label="Light Remote account sign-in">
      <aside className="auth-brand-panel">
        <div className="auth-brand-lockup">
          <img src="./brand-mark.svg" width={53} height={53} alt="" />
          <span><strong>LIGHT REMOTE</strong><small>DESKTOP V4 · PRIVATE BY DESIGN</small></span>
        </div>
        <div className="auth-brand-message">
          <span className="auth-gold-rule" />
          <h1>Control your AI<br />workforce safely.</h1>
          <p>One account for your devices, sessions and local Wall. Owner approval stays separate from Agent access.</p>
        </div>
        <div className="auth-steps" aria-label="Secure account entry steps">
          <div><CheckCircle2 size={18} aria-hidden="true" /> Verify your Light Remote account</div>
          <div><LockKeyhole size={18} aria-hidden="true" /> Restore your secure desktop session</div>
          <div><ShieldCheck size={18} aria-hidden="true" /> Open Wall without another password</div>
        </div>
        <p className="auth-brand-footnote">Local login does not approve A/B grants.</p>
      </aside>
      <main className="auth-main">
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-card-gold-rule" />
          <p className="auth-eyebrow">{detail?.label || 'ACCOUNT AUTHENTICATION'}</p>
          <h2 id="auth-title">{detail?.title || 'Welcome to Light Remote'}</h2>
          <p className="auth-lede">
            {detail?.description || 'Sign in before entering your workspace. Your devices and identity remain protected.'}
          </p>
          {mode === 'signed-out' ? (
            <>
              <div className="auth-secure-note">
                <ShieldCheck size={21} aria-hidden="true" />
                <div><strong>SECURE SIGN-IN · SYSTEM BROWSER</strong>
                  <p>No password or access token is entered in the app.</p>
                </div>
              </div>
              <button type="button" className="auth-primary" disabled={!nativeLogin}
                title={nativeLogin ? 'Open the verified Light Remote Account Portal in your system browser'
                  : 'Owner login callback is not connected in this UI-only pilot'}
                onClick={() => onBrowserSignIn?.()}>
                <ExternalLink size={18} aria-hidden="true" /> Continue in browser
              </button>
              <p className="auth-disabled-note">{nativeLogin
                ? 'Owner sign-in requires browser confirmation. Agent A/B access stays separate.'
                : 'Account verification is not connected in this test build.'}</p>
              <div className="auth-session-hint">
                <Fingerprint size={21} aria-hidden="true" />
                <div><strong>Stay signed in securely on this device</strong>
                  <p>Future sessions use OS credential storage and support revocation.</p>
                </div>
              </div>
            </>
          ) : (
            <div className="auth-state-panel" role="status">
              {mode === 'app-lock' ? <Fingerprint size={30} aria-hidden="true" /> :
                mode === 'restoring' ? <RotateCcw size={30} aria-hidden="true" /> :
                <LockKeyhole size={30} aria-hidden="true" />}
              <strong>{mode === 'app-lock' ? 'OS unlock required'
                : mode === 'browser-pending' ? (nativeLogin ? 'Waiting for verified browser callback' : 'No verified callback yet')
                : 'Access stays locked'}</strong>
              <p>{nativeLogin
                ? mode === 'browser-pending' ? 'Approve this sign-in in your system browser. No Agent authorization is created.'
                  : mode === 'restoring' ? 'Verifying the protected OS credential with the Owner server.'
                  : 'The prior Owner session is unavailable or expired. Start a fresh browser sign-in.'
                : detail?.note ?? ""}</p>
              <button type="button" className="auth-back"
                onClick={nativeLogin
                  ? (mode === 'expired' ? onBrowserSignIn : onCancelSignIn)
                  : () => setPreviewMode('signed-out')}>
                {nativeLogin ? (mode === 'expired' ? 'Sign in again' : 'Cancel sign-in') : 'Back to sign in'}
              </button>
            </div>
          )}
          {allowDesignPreview && (
            <div className="auth-preview" aria-label="UI test controls">
              <div className="auth-preview-banner"><strong>UI TEST ONLY</strong><span>Not signed in · no Owner authority</span></div>
              <button type="button" className="auth-preview-enter" onClick={onPreviewWorkspace}>
                Explore UI (design preview) <ArrowRight size={17} aria-hidden="true" />
              </button>
              <p>Preview screens and session states below. No backend login, A/B approval or persistent token is created.</p>
              <div className="auth-preview-states">
                {previews.map(item => (
                  <button type="button" key={item.key}
                    aria-pressed={previewMode === item.key}
                    onClick={() => setPreviewMode(item.key)}>{item.label}</button>
                ))}
              </div>
            </div>
          )}
          {!allowDesignPreview && <p className="auth-preview-disclaimer">
            {nativeLogin
              ? 'Account verification does not approve Agent access or Local Wall SSO.'
              : 'Account sign-in is required. This build has no Owner authorization bridge and cannot enter the workspace.'}
          </p>}
        </section>
        <div className="auth-footer"><ShieldCheck size={16} aria-hidden="true" />
          Account login, device linking and Agent authorization are independent security steps.
        </div>
      </main>
    </div>
  );
}
