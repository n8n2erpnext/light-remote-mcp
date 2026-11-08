import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { LEGACY_MULTIPLEXED_TOOL_NAMES, callLegacyMultiplexedTool } from './tools.mjs';

export function installLegacyToolCallCompat(mcpServer,identity){
  const protocol=mcpServer?.server;
  const registry=protocol?._requestHandlers;
  if(!(registry instanceof Map))throw new Error('mcp_tool_registry_unavailable');
  const baseHandler=registry.get('tools/call');
  if(typeof baseHandler!=='function')throw new Error('mcp_tools_call_unavailable');

  protocol.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
    const name=String(request?.params?.name||'');
    const args=request?.params?.arguments;
    if(LEGACY_MULTIPLEXED_TOOL_NAMES.has(name)&&args&&typeof args==='object'&&typeof args.operation==='string'){
      const legacy=await callLegacyMultiplexedTool(identity,name,args);
      if(legacy)return legacy;
    }
    return baseHandler(request,extra);
  });
}
