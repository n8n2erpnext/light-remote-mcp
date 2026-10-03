import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

function cloneSchemes(rows){
  return rows.map(row=>({type:row.type,scopes:Array.isArray(row.scopes)?[...row.scopes]:[]}));
}

export function installOpenAiToolSecurityCompat(mcpServer,securityByTool){
  const protocol=mcpServer?.server;
  const registry=protocol?._requestHandlers;
  if(!(registry instanceof Map)) throw new Error('mcp_tool_registry_unavailable');
  const baseHandler=registry.get('tools/list');
  if(typeof baseHandler!=='function') throw new Error('mcp_tools_list_unavailable');

  protocol.setRequestHandler(ListToolsRequestSchema,async(request,extra)=>{
    const listed=await baseHandler(request,extra);
    const tools=(listed.tools||[]).map(tool=>{
      const schemes=securityByTool[tool.name];
      if(!Array.isArray(schemes)||schemes.length===0) throw new Error(`missing_tool_security:${tool.name}`);
      return {...tool,securitySchemes:cloneSchemes(schemes)};
    });
    return {...listed,tools};
  });
}
