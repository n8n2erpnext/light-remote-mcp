import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGoldCodexConnection} from '../../device-agent/gold-codex-api.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-codex-errors-'));
const dummy='sk-test-gold-failure-code-only-123456789';
const scenarios=[
  {
    name:'billing http response',
    handler:async()=>new Response(JSON.stringify({error:{code:'credit_balance_exhausted',message:'do not echo token sk-secret'}}),{status:429,headers:{'Content-Type':'application/json'}}),
    expected:{status:'rejected',httpStatus:429,errorCode:'credit_balance_exhausted',completed:false}
  },
  {
    name:'invalid model http response',
    handler:async()=>new Response(JSON.stringify({error:{code:'model_not_found'}}),{status:404}),
    expected:{status:'rejected',httpStatus:404,errorCode:'model_not_found',completed:false}
  },
  {
    name:'turn failure SSE',
    handler:async()=>new Response('data: '+JSON.stringify({type:'agent.session.created',session_id:'session_mock_12'})+'\n\n'+
      'data: '+JSON.stringify({type:'agent.session.turn.failed',turn:{error:{code:'credit_balance_exhausted',message:'sensitive'}}})+'\n\n',
      {status:200,headers:{'Content-Type':'text/event-stream'}}),
    expected:{status:'failed',errorCode:'credit_balance_exhausted',completed:false}
  },
  {
    name:'generic turn failure SSE',
    handler:async()=>new Response('data: '+JSON.stringify({type:'agent.session.turn.failed'})+'\n\n',
      {status:200,headers:{'Content-Type':'text/event-stream'}}),
    expected:{status:'failed',errorCode:'agent_turn_failed',completed:false}
  }
];
try{
  for(let i=0;i<scenarios.length;i++){
    const scenario=scenarios[i];
    const client=createGoldCodexConnection({storageFile:path.join(root,'c'+i+'.json'),
      fetchImpl:async(url,opts)=>{
        assert.equal(url,'https://api.openai.com/v1/agents/sessions');
        assert.equal(opts.headers.Authorization,'Bearer '+dummy);
        return scenario.handler();
      }});
    client.save({apiKey:dummy,model:'gpt-6.1-sol'});
    const result=await client.run({tasks:[{title:'safe work',state:'todo'}]});
    for(const [key,value] of Object.entries(scenario.expected))assert.equal(result[key],value,scenario.name+': '+key);
    assert.equal(JSON.stringify(result).includes(dummy),false);
    assert.equal(JSON.stringify(result).includes('sensitive'),false);
    assert.equal(JSON.stringify(result).includes('sk-secret'),false);
    assert.equal(result.model,'gpt-6.1-sol');
  }
  console.log('GOLD_CODEX_BILLING_MODEL_TURN_FAILURE_DIAGNOSTIC_CODES_PASS');
  console.log('GOLD_CODEX_FAILURE_DIAGNOSTICS_NO_REAL_API_CALLS_PASS');
}finally{fs.rmSync(root,{recursive:true,force:true});}
