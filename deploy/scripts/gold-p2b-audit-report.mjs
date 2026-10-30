#!/usr/bin/env node
// Consume only anonymous JSON aggregates from the P2-B READ ONLY SQL.
// This CLI never connects to DB or performs mutations. Exit 4 = HOLD.
import {evaluateP2BQuiescence} from '../../lib/gold-p2b-signed-quiescence.mjs';
let input='';
try{
 for await(const chunk of process.stdin){
  input+=chunk;
  if(input.length>8192)throw Error('p2b_quiescence_input_too_large');
 }
 const result=evaluateP2BQuiescence(JSON.parse(input.trim()));
 console.log(JSON.stringify(result,null,2));
 process.exitCode=4;
}catch(error){
 // Never dump raw input: it could contain identifiers or secret content.
 console.error('P2B_AGGREGATE_INPUT_INVALID');
 process.exitCode=5;
}
