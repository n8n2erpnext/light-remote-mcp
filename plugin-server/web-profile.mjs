export function getWebProfile(env = process.env) {
  const agentRequests = env.LR_GOLD_AB_V2_ACCOUNT_UI === '1';
  const shareEnabled = ['LR_GOLD_PRO_SHARE_CORE','LR_GOLD_PRO_SHARE_ACCOUNT_HTTP','LR_GOLD_PRO_SHARE_PORTAL_UI']
    .every(key => env[key] === '1');
  return { agentRequests, shareEnabled, family:agentRequests || shareEnabled };
}

export function renderWebProfile(source, profile = getWebProfile()) {
  const sections = {
    'agent-requests':profile.agentRequests,
    'legacy-pairing':!profile.agentRequests,
    family:profile.family,
    'legacy-team':!profile.family,
  };
  const labels = {
    PAIRING:profile.agentRequests?'agent-request':'legacy',
    SHARE_ENABLED:profile.shareEnabled?'true':'false',
    SHARE_LINK:profile.family?'/account/pro-share':'/account/team',
    SHARE_LABEL:profile.family?'Pro Share (Family)':'Pro Team',
  };
  return source
    .replace(/<!-- profile:([a-z-]+) -->([\s\S]*?)<!-- \/profile:\1 -->/g,
      (_,key,body) => sections[key] ? body : '')
    .replace(/__WEB_(PAIRING|SHARE_ENABLED|SHARE_LINK|SHARE_LABEL)__/g, (_,key) => labels[key]);
}
