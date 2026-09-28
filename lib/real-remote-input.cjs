const MAX_EVENTS=64;
const MAX_TEXT_LENGTH=4096;
const MAX_JSON_BYTES=64*1024;
const BUTTONS=new Set(['left','right','middle']);
const MODIFIERS=new Set(['CTRL','ALT','SHIFT','WIN']);
const NAMED_KEYS=new Set(['ENTER','TAB','ESC','BACKSPACE','DELETE','LEFT','RIGHT','UP','DOWN','HOME','END','PAGEUP','PAGEDOWN','SPACE',...Array.from({length:12},(_,i)=>`F${i+1}`)]);

function fail(message,status=400){const error=new Error(message);error.status=status;throw error;}
function integer(value,name,min,max,{required=true}={}){
  if(value==null&&!required)return undefined;
  const number=Number(value);
  if(!Number.isInteger(number)||number<min||number>max)fail(`desktop_input_invalid_${name}`);
  return number;
}
function coordinatePair(event){
  const hasX=event.x!=null,hasY=event.y!=null;
  if(hasX!==hasY)fail('desktop_input_coordinates_incomplete');
  if(!hasX)return {};
  return {x:integer(event.x,'x',-100000,100000),y:integer(event.y,'y',-100000,100000)};
}
function keyName(value){
  const key=String(value||'').trim().toUpperCase();
  if(/^[A-Z0-9]$/.test(key)||NAMED_KEYS.has(key))return key;
  fail('desktop_input_invalid_key');
}
function modifiers(value){
  if(value==null)return [];
  if(!Array.isArray(value)||value.length>4)fail('desktop_input_invalid_modifiers');
  const out=[];
  for(const raw of value){
    const item=String(raw||'').trim().toUpperCase();
    if(!MODIFIERS.has(item))fail('desktop_input_invalid_modifier');
    if(!out.includes(item))out.push(item);
  }
  return out;
}
function normalizeEvent(value){
  if(!value||typeof value!=='object'||Array.isArray(value))fail('desktop_input_event_required');
  const type=String(value.type||'').trim().toLowerCase();
  if(type==='move'){
    if(value.x==null||value.y==null)fail('desktop_input_coordinates_required');
    return {type,...coordinatePair(value)};
  }
  if(type==='click'){
    const button=String(value.button||'left').trim().toLowerCase();
    if(!BUTTONS.has(button))fail('desktop_input_invalid_button');
    return {type,button,count:integer(value.count??1,'count',1,3),...coordinatePair(value)};
  }
  if(type==='wheel'){
    const delta=integer(value.delta,'wheel',-1200,1200);
    if(delta===0)fail('desktop_input_invalid_wheel');
    return {type,delta,...coordinatePair(value)};
  }
  if(type==='text'){
    const text=String(value.text??'');
    if(!text.length||text.length>MAX_TEXT_LENGTH)fail('desktop_input_invalid_text');
    return {type,text};
  }
  if(type==='key'){
    return {type,key:keyName(value.key),modifiers:modifiers(value.modifiers)};
  }
  fail('desktop_input_event_unsupported');
}
function normalizeDesktopInput(value){
  if(!value||typeof value!=='object'||Array.isArray(value))fail('desktop_input_required');
  if(!Array.isArray(value.events)||!value.events.length||value.events.length>MAX_EVENTS)fail('desktop_input_invalid_event_count');
  const result={events:value.events.map(normalizeEvent)};
  if(value.semanticSessionId!=null){
    const semanticSessionId=String(value.semanticSessionId||'').trim();
    if(!/^sem_[A-Za-z0-9_-]{8,76}$/.test(semanticSessionId))fail('desktop_input_invalid_semantic_session');
    result.semanticSessionId=semanticSessionId;
    if(value.afterSeq!=null)result.afterSeq=integer(value.afterSeq,'after_seq',0,Number.MAX_SAFE_INTEGER);
    result.settleMs=integer(value.settleMs??90,'settle_ms',0,250);
  }else if(value.afterSeq!=null||value.settleMs!=null)fail('desktop_input_semantic_session_required');
  if(Buffer.byteLength(JSON.stringify(result))>MAX_JSON_BYTES)fail('desktop_input_too_large',413);
  return result;
}

module.exports={MAX_EVENTS,MAX_TEXT_LENGTH,MAX_JSON_BYTES,normalizeDesktopInput};
