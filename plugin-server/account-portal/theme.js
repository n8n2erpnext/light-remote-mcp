(()=>{
  const KEY='light-remote-theme';
  const valid=v=>v==='dark'||v==='light';
  // Dark is the product default for new visitors. Explicit prior choice always wins.
  const preferred=()=> 'dark';
  const get=()=>{try{const v=localStorage.getItem(KEY);return valid(v)?v:preferred();}catch{return preferred();}};
  const apply=mode=>{const v=valid(mode)?mode:'dark';document.documentElement.dataset.theme=v;document.documentElement.style.colorScheme=v;return v;};
  const set=mode=>{const v=apply(mode);try{localStorage.setItem(KEY,v);}catch{};window.dispatchEvent(new CustomEvent('light-remote-theme',{detail:{theme:v}}));return v;};
  apply(get());
  window.LightRemoteTheme={get,set,apply};
})();