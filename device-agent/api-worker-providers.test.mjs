import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createClaudeWorker,createGeminiWorker } from './api-worker-providers.mjs';

const signal=new AbortController().signal;
const call={model:'review-model',prompt:'PRIVATE_CONTEXT',context:'Unicode Việt 😀',signal,verify:async()=>true};

test('Claude uses official local auth and text-only CLI flags, with the request over stdin',async()=>{
  const calls=[];
  const spawnImpl=(command,args,options)=>{
    const child=new EventEmitter();
    child.stdin=new PassThrough();
    child.stdout=new PassThrough();
    const row={command,args,options,stdin:''};calls.push(row);
    child.stdin.on('data',chunk=>row.stdin+=chunk);
    queueMicrotask(()=>{
      const output=args[0]==='--version'?'2.1.320 (Claude Code)':
        args[0]==='auth'?{loggedIn:true,authMethod:'claude.ai',email:'private@example.test',token:'opaque-private'}:
        {type:'result',subtype:'success',is_error:false,num_turns:1,
          result:'Review',modelUsage:{'actual-model':{}},usage:{input_tokens:10,output_tokens:3}};
      child.stdout.end(typeof output==='string'?output:JSON.stringify(output));child.emit('close',0);
    });
    return child;
  };
  const provider=createClaudeWorker({binary:process.execPath,model:call.model,cwd:process.cwd(),spawnImpl,
    env:{PATH:'test',CLAUDE_CODE_OAUTH_TOKEN:'do not copy',ANTHROPIC_BASE_URL:'https://proxy.invalid'}});
  assert.equal((await provider.check(signal)).authState,'signed_in');
  assert.doesNotMatch(JSON.stringify(provider.status()),/private|example/);
  assert.deepEqual(await provider.run(call),{text:'Review',model:'actual-model',usage:{inputTokens:10,outputTokens:3}});
  const last=calls.at(-1);
  assert.equal(last.options.shell,false);
  assert.deepEqual(last.options.env,{PATH:'test'});
  assert.doesNotMatch(last.args.join(),/PRIVATE_CONTEXT|Unicode/);
  assert.equal(last.args[last.args.indexOf('--tools')+1],'');
  for(const expected of ['--safe-mode','--strict-mcp-config','--no-session-persistence'])assert.ok(last.args.includes(expected));
  assert.deepEqual(JSON.parse(last.stdin),{request:call.prompt,reference:call.context});
  await assert.rejects(provider.run({...call,model:'--help'}),/model_invalid/);
});

test('Gemini connects to the fixed official API without tools and reports actual partial usage',async()=>{
  const calls=[];
  const key='fixture_Gemini_api_key_not_real';
  const provider=createGeminiWorker({apiKey:key,model:call.model,fetchImpl:async(url,options)=>{
    calls.push({url,options});
    const response=options.method==='GET'?{name:'models/review-model'}:{
      candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'private reasoning'},{text:'Review'}]}}],
      modelVersion:'actual-gemini',usageMetadata:{promptTokenCount:14,totalTokenCount:20}
    };
    return Response.json(response);
  }});
  assert.equal((await provider.check(signal)).authState,'authenticated');
  assert.equal(calls[0].options.method,'GET');
  const result=await provider.run(call);
  assert.deepEqual(result,{text:'Review',model:'actual-gemini',usage:{inputTokens:14,outputTokens:undefined,totalTokens:20}});
  assert.equal(calls[1].url,'https://generativelanguage.googleapis.com/v1beta/models/review-model:generateContent');
  assert.equal(calls[1].options.headers['x-goog-api-key'],key);
  assert.equal(calls[1].options.redirect,'error');
  assert.ok(!Object.hasOwn(JSON.parse(calls[1].options.body),'tools'));
  assert.equal(JSON.parse(calls[1].options.body).generationConfig.maxOutputTokens,2048);
  await assert.rejects(provider.run({...call,verify:async()=>{throw Error('revoked');}}),/revoked/);
  assert.equal(calls.length,2);
  assert.doesNotMatch(JSON.stringify(provider.status()),/api_key_not_real/);
});

test('Gemini rejects missing setup, quota errors and incomplete responses without leaking provider details',async()=>{
  const unset=createGeminiWorker({fetchImpl:()=>assert.fail('unconfigured provider called')});
  await assert.rejects(unset.check(signal),/provider_setup_required/);
  let status=429;
  const provider=createGeminiWorker({apiKey:'fixture_api_key_not_real_gemini',model:call.model,
    fetchImpl:async()=>Response.json({error:'PRIVATE_PROVIDER_DIAGNOSTIC',
      candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'Partial'}]}}]},{status})});
  await assert.rejects(provider.run(call),{message:'api_worker_provider_rate_limited'});
  status=200;
  await assert.rejects(provider.run(call),{message:'api_worker_gemini_review_incomplete'});
});
