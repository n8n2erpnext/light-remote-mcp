function transferOwner(req){
  return {
    clientSessionId:req.plusClient?.clientSessionId,
    agentId:req.plusClient?.agentId,
    deviceId:req.plusClientDeviceId
  };
}
function sendError(res,error){
  return res.status(Number(error?.status)||400).json({ok:false,error:String(error?.message||'transfer_failed')});
}
function transferId(req){return String(req.params?.id||'').trim();}

export function createPlusTransferHandlers(deps){
  const {registry,callOperatorJson,sealOperatorPayload}=deps||{};
  if(!registry||!callOperatorJson||!sealOperatorPayload)throw new Error('plus_transfer_dependencies_required');

  const begin=(req,res)=>{
    try{
      const body=req.body||{};
      const purpose=String(body.purpose||'operator-payload');
      if(purpose!=='operator-payload')return res.status(400).json({ok:false,error:'unsupported_transfer_purpose'});
      const transfer=registry.begin(transferOwner(req),{purpose,totalBytes:body.totalBytes,totalChunks:body.totalChunks,sha256:body.sha256});
      return res.json({ok:true,transfer});
    }catch(error){return sendError(res,error);}
  };
  const put=(req,res)=>{
    try{
      const body=req.body||{};
      const transfer=registry.put(transferOwner(req),transferId(req),{index:body.index,data:body.data,sha256:body.sha256});
      return res.json({ok:true,transfer});
    }catch(error){return sendError(res,error);}
  };
  const status=(req,res)=>{
    try{return res.json({ok:true,transfer:registry.view(transferOwner(req),transferId(req))});}
    catch(error){return sendError(res,error);}
  };
  const cancel=(req,res)=>{
    try{return res.json(registry.cancel(transferOwner(req),transferId(req)));}
    catch(error){return sendError(res,error);}
  };

  const commit=async(req,res)=>{
    try{
      const owner=transferOwner(req),id=transferId(req);
      const assembled=registry.assemble(owner,id);
      if(assembled.transfer.purpose!=='operator-payload')throw new Error('unsupported_transfer_purpose');
      let payload;
      try{payload=JSON.parse(assembled.data.toString('utf8'));}
      catch{const error=new Error('transfer_payload_json_invalid');error.status=400;throw error;}
      if(!payload||typeof payload!=='object'||Array.isArray(payload)){const error=new Error('transfer_payload_invalid');error.status=400;throw error;}
      const allowed=new Set(['exec_batch','fs','process','search','scp']);
      if(!allowed.has(String(payload.action||''))){const error=new Error('transfer_payload_action_not_allowed');error.status=400;throw error;}
      const agentId=String(req.plusClient?.agentId||'').trim();
      const nodeId=String(req.plusClientDevice?.device?.nodeId||'').trim();
      if(!agentId){const error=new Error('transfer_agent_identity_missing');error.status=401;throw error;}
      payload={...payload,agentId,...(nodeId?{nodeId}:{})};
      const grantId=req.plusClientDevice?.grant?.grantId;
      if(!grantId){const error=new Error('transfer_device_grant_missing');error.status=403;throw error;}
      const upstream=await callOperatorJson('POST','/v1/device-access/execute',{grantId,envelope:sealOperatorPayload(payload),telemetry:{bridgeReceivedAt:req.body?.bridgeReceivedAt,gatewayAcceptedAt:req.lightRemoteAcceptedAt}});
      registry.release(owner,id);
      return res.json(upstream);
    }catch(error){return sendError(res,error);}
  };
  return {begin,put,status,commit,cancel};
}
