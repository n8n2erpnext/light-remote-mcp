import assert from 'node:assert/strict';
import vm from 'node:vm';
import {wallAbV2PreviewFragment as fragment} from '../../device-agent/wall-ab-v2-preview.mjs';

assert.match(fragment,/ab2-grid/);
assert.match(fragment,/ab2-code-card/);
assert.match(fragment,/Get the B code from the AI chat, then enter it in Block B/);
assert.match(fragment,/ab2-flow svg/);
assert.match(fragment,/@media\(prefers-reduced-motion:reduce\)/);
assert.match(fragment,/font-size:26px;font-weight:800/);
assert.match(fragment,/Array\.from\(\{length:8\}/);
assert.match(fragment,/inputMode='text'/);
assert.match(fragment,/autocomplete='off'/);
assert.match(fragment,/readB\(\)/);
assert.match(fragment,/await window\.lrWebConfirm/);
assert.match(fragment,/input\.value=''|clearB\(\)/);
assert.match(fragment,/items\.contains\(focused\)/);
assert.doesNotMatch(fragment,/maxLength=9/);

const start=fragment.indexOf('const normalizeBText=text=>{');
const end=fragment.indexOf('    b.append(bTitle,bHelp,digits);',start);
assert.ok(start>0&&end>start);
const code=fragment.slice(start,end);
const cells=Array.from({length:8},()=>({
 value:'',handlers:{},
 addEventListener(k,fn){this.handlers[k]=fn;},
 focus(){focused=this;},
 select(){},
 emit(k,e={}){this.handlers[k]?.(Object.assign({preventDefault(){},clipboardData:null},e));}
}));
let focused=null;
const status={textContent:''};
const api=vm.runInNewContext(code+'\n({normalizeBText,clearB,readB,fillB})',{cells,status});
assert.equal(api.normalizeBText('B: DJGF-J6FN'),'DJGFJ6FN');
assert.equal(api.normalizeBText('d j g f - j 6 f n'),'DJGFJ6FN');
assert.equal(api.normalizeBText('B code: DJGF-J6FN'),'DJGFJ6FN');
assert.equal(api.normalizeBText('D0G1-J6FN'),'DGJ6FN','invalid alphabet excluded');
assert.equal(api.readB(),'', 'no empty B may pass');

cells[0].emit('paste',{clipboardData:{getData:()=> 'B: DJGF - J6FN'}});
assert.equal(api.readB(),'DJGF-J6FN');
assert.equal(focused,cells[7]);
cells[0].emit('paste',{clipboardData:{getData:()=> '   D J G F - J 6 F N  ' }});
assert.equal(api.readB(),'DJGF-J6FN');
cells[0].emit('paste',{clipboardData:{getData:()=> 'ABCD-EFGH'}});
assert.equal(api.readB(),'ABCD-EFGH');
api.clearB();
cells[0].value='d';cells[0].emit('input');
assert.equal(cells[0].value,'D');
assert.equal(focused,cells[1]);
cells[1].emit('keydown',{key:'Backspace'});
assert.equal(cells[0].value,'');
assert.equal(focused,cells[0]);
api.fillB('DJGF-J6F',0);
assert.equal(api.readB(),'', 'incomplete B must fail');
cells[7].value='N';
assert.equal(api.readB(),'DJGF-J6FN');

const embedded=fragment.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(embedded);
new vm.Script(embedded);
console.log('GOLD_ABV2_SEGMENTED_B8_PASTE_TYPE_BACKSPACE_VALIDATION_SOURCE=PASS');