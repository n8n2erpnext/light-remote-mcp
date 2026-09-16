import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export function installOpenAiToolSecurityCompat(mcpServer, securityByTool) {
  const protocol=mcpServer?.server;
  const handlers=protocol?._requestHandlers;
  if(!(handlers instanceof Map)) throw new Error('mcp_sdk_request_handler_registry_unavailable');
  const original=handlers.get('tools/list');
  if(typeof original!=='function') throw new Error('mcp_sdk_tools_list_handler_missing');
  protocol.setRequestHandler(ListToolsRequestSchema, async (request,extra)=>{
    const result=await original(request,extra);
    return {...result,tools:(result.tools||[]).map(tool=>{
      const schemes=securityByTool[tool.name];
      if(!Array.isArray(schemes)||!schemes.length) throw new Error(`tool_security_scheme_missing:${tool.name}`);
      return {...tool,securitySchemes:schemes.map(s=>({...s,scopes:[...(s.scopes||[])]}))};
    })};
  });
}
