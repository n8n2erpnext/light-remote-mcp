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
  onGoogleSignIn?: () => void;
  onCancelSignIn?: () => void;
  onLinkDevice?: () => void;
};

const states: Record<Exclude<AuthEntryMode, 'signed-out'>, {
  label: string; title: string; description: string; note: string
}> = {
  'browser-pending': {
    label: 'BROWSER VERIFICATION',
    title: 'Awaiting secure sign-in',
    description: 'Finish signing in in your browser. We’ll bring you back when you’re ready.',
    note: 'No account callback is connected in this UI-only build.'
  },
  restoring: {
    label: 'RESTORE SESSION',
    title: 'Checking your saved session',
    description: 'We’re checking your saved sign-in. This usually takes a moment.',
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
    description: 'Your previous session ended. Sign in again to return to your workspace.',
    note: 'Your enrolled device identity can remain stored without granting Agent access.'
  },
  'account-mismatch': {
    label: 'ACCOUNT MISMATCH',
    title: 'This is a different account',
    description: 'This PC is linked to a different account. Sign in with the account that owns this device, or review device linking.',
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
  nativePhase, onBrowserSignIn, onGoogleSignIn, onCancelSignIn, onLinkDevice }: Props) {
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
          <span><strong>LIGHT REMOTE</strong><small>YOUR AI WORKSPACE</small></span>
        </div>
        <div className="auth-brand-message">
          <span className="auth-gold-rule" />
          <h1>Your AI. Your devices.<br />You’re in control.</h1>
          <p>Connect your computers, approve your AI agents and follow their work in one place.</p>
        </div>
        <div className="auth-steps" aria-label="Secure account entry steps">
          <div><CheckCircle2 size={18} aria-hidden="true" /> Sign in to your Light Remote account</div>
          <div><LockKeyhole size={18} aria-hidden="true" /> Connect the devices you want to use</div>
          <div><ShieldCheck size={18} aria-hidden="true" /> Choose which AI agents can work</div>
        </div>
        <p className="auth-brand-footnote">AI agents only get access when you approve them.</p>
      </aside>
      <main className="auth-main">
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-card-gold-rule" />
          <p className="auth-eyebrow">{detail?.label || 'YOUR WORKSPACE'}</p>
          <h2 id="auth-title">{detail?.title || 'Welcome to Light Remote'}</h2>
          <p className="auth-lede">
            {detail?.description || 'Sign in to manage your devices and work with your AI agents.'}
          </p>
          {mode === 'signed-out' ? (
            <>
              <div className="auth-secure-note">
                <ShieldCheck size={21} aria-hidden="true" />
                <div><strong>Sign in with your browser</strong>
                  <p>Your password stays in the browser. We’ll bring you back to Desktop.</p>
                </div>
              </div>
              <button type="button" className="auth-google" disabled={!nativeLogin || !onGoogleSignIn}
                title={nativeLogin && onGoogleSignIn
                  ? 'Continue with Google in your system browser'
                  : 'Google sign-in is not connected in this UI-only pilot'}
                onClick={() => onGoogleSignIn?.()}>
                Continue with Google
              </button>
              <div className="auth-sign-in-divider" aria-hidden="true"><span>or</span></div>
              <button type="button" className="auth-primary" disabled={!nativeLogin}
                title={nativeLogin ? 'Open the verified Light Remote Account Portal in your system browser'
                  : 'Owner login callback is not connected in this UI-only pilot'}
                onClick={() => onBrowserSignIn?.()}>
                <ExternalLink size={18} aria-hidden="true" /> Continue in browser
              </button>
              <p className="auth-disabled-note">{nativeLogin
                ? 'A browser window will open to confirm your sign-in.'
                : 'Account verification is not connected in this test build.'}</p>
              <div className="auth-session-hint">
                <Fingerprint size={21} aria-hidden="true" />
                <div><strong>Stay signed in securely on this device</strong>
                  <p>Your sign-in is kept in this PC’s protected credential storage.</p>
                </div>
              </div>
            </>
          ) : (
            <div className="auth-state-panel" role="status">
              {mode === 'app-lock' ? <Fingerprint size={30} aria-hidden="true" /> :
                mode === 'restoring' ? <RotateCcw size={30} aria-hidden="true" /> :
                <LockKeyhole size={30} aria-hidden="true" />}
              <strong>{mode === 'app-lock' ? 'OS unlock required'
                : mode === 'browser-pending' ? (nativeLogin ? 'Waiting for you to finish signing in' : 'No verified callback yet')
                : 'Access stays locked'}</strong>
              <p>{nativeLogin
                ? mode === 'browser-pending' ? 'Continue in the browser window that opened. You can cancel and try again if needed.'
                  : mode === 'restoring' ? 'Checking your saved sign-in with your account.'
                  : 'Your saved sign-in is no longer available. Sign in again to continue.'
                : detail?.note ?? ""}</p>
              <button type="button" className="auth-back"
                onClick={nativeLogin
                  ? (mode === 'expired' ? onBrowserSignIn : onCancelSignIn)
                  : () => setPreviewMode('signed-out')}>
                {nativeLogin ? (mode === 'expired' ? 'Sign in again' : 'Cancel sign-in') : 'Back to sign in'}
              </button>
            </div>
          )}
          {onLinkDevice&&<button type="button" className="auth-back auth-local-link" onClick={onLinkDevice}>Link / Relink this PC</button>}
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
              ? 'Signing in does not give an AI agent access to your devices.'
              : 'Account sign-in is required. This build has no Owner authorization bridge and cannot enter the workspace.'}
          </p>}
        </section>
        <div className="auth-footer"><ShieldCheck size={16} aria-hidden="true" />
          Your account. Your devices. You choose who gets access.
        </div>
      </main>
    </div>
  );
}
