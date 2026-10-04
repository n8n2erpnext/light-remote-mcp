(()=>{
  const KEY='light-remote-theme';
  const valid=v=>v==='dark'||v==='light';
  const preferred=()=>window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';
  const get=()=>{try{const v=localStorage.getItem(KEY);return valid(v)?v:preferred();}catch{return preferred();}};
  const apply=mode=>{const v=valid(mode)?mode:'dark';document.documentElement.dataset.theme=v;document.documentElement.style.colorScheme=v;return v;};
  const set=mode=>{const v=apply(mode);try{localStorage.setItem(KEY,v);}catch{};window.dispatchEvent(new CustomEvent('light-remote-theme',{detail:{theme:v}}));return v;};
  apply(get());
  window.LightRemoteTheme={get,set,apply};
})();