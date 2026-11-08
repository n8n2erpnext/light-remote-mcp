import crypto from 'node:crypto';
import { z } from 'zod';
import { callOperatorJson } from './operator-proxy.mjs';
import { sealOperatorPayload } from './operator-crypto.mjs';

const id=z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const agentId=z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/);
const opId=z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/);
const textPath=z.string().min(1).max(4096);
const ann=(readOnly=false,destructive=false,idempotent=false)=>({readOnlyHint:readOnly,destructiveHint:destructive,idempotentHint:idempotent,openWorldHint:false});
async function submitFs({sessionId,agentId:ownerAgentId,operationId,fs,waitMs=7000}){
  const ctx=await context(sessionId,ownerAgentId);
  const payload={action:'fs',operationId,sessionId,agentId:ownerAgentId,nodeId:ctx.session.nodeId,fs,waitMs};
  return callOperatorJson('POST','/v1/fs',sealOperatorPayload(payload));
}
async function submitProcess({sessionId,agentId:ownerAgentId,operationId,process,waitMs=7000}){
  const ctx=await context(sessionId,ownerAgentId);
  const payload={action:'process',operationId,sessionId,agentId:ownerAgentId,nodeId:ctx.session.nodeId,process,waitMs};
  return callOperatorJson('POST','/v1/process',sealOperatorPayload(payload));
}
async function submitSearch({sessionId,agentId:ownerAgentId,operationId,search,waitMs=7000}){
  const ctx=await context(sessionId,ownerAgentId);
  const payload={action:'search',operationId,sessionId,agentId:ownerAgentId,nodeId:ctx.session.nodeId,search,waitMs};
  return callOperatorJson('POST','/v1/search',sealOperatorPayload(payload));
}

export function registerConvenienceTools(server,tracked,identity){
  const baseInput={sessionId:id,agentId};
  server.registerTool('light_remote_read_text_file',{
    title:'Read remote text file',
    description:'Read a bounded line range from a UTF-8-ish text file on the selected session target.',
    inputSchema:{...baseInput,path:textPath,startLine:z.number().int().min(1).optional(),maxLines:z.number().int().min(1).max(5000).optional(),tailLines:z.number().int().min(1).max(5000).optional()},
    annotations:ann(true,false,true)
  },tracked('light_remote_read_text_file',identity,async input=>submitFs({sessionId:input.sessionId,agentId:input.agentId,operationId:`read-${crypto.randomUUID()}`,fs:{op:'read',path:input.path,startLine:input.startLine,maxLines:input.maxLines,tailLines:input.tailLines}})));

  server.registerTool('light_remote_read_multiple_files',{
    title:'Read multiple remote text files',
    description:'Read bounded text from up to 20 files on the selected target in one structured operation.',
    inputSchema:{...baseInput,paths:z.array(textPath).min(1).max(20),maxBytesPerFile:z.number().int().min(1).max(1048576).optional()},
    annotations:ann(true,false,true)
  },tracked('light_remote_read_multiple_files',identity,async input=>submitFs({sessionId:input.sessionId,agentId:input.agentId,operationId:`multiread-${crypto.randomUUID()}`,fs:{op:'readMany',paths:input.paths,maxBytesPerFile:input.maxBytesPerFile}})));

  server.registerTool('light_remote_edit_block',{
    title:'Edit exact remote text block',
    description:'Replace an exact text block without shell quoting. Fails if the expected replacement count does not match.',
    inputSchema:{...baseInput,operationId:opId,path:textPath,oldText:z.string().min(1).max(4000000),newText:z.string().max(4000000),expectedReplacements:z.number().int().min(1).max(100).optional()},
    annotations:ann(false,true,true)
  },tracked('light_remote_edit_block',identity,async input=>submitFs({sessionId:input.sessionId,agentId:input.agentId,operationId:input.operationId,fs:{op:'edit',path:input.path,oldText:input.oldText,newText:input.newText,expectedReplacements:input.expectedReplacements||1}})));

  server.registerTool('light_remote_list_directory',{
    title:'List remote directory',
    description:'List one directory on the selected target, including hidden entries where the platform supports it.',
    inputSchema:{...baseInput,path:textPath,maxEntries:z.number().int().min(1).max(1000).optional(),maxDepth:z.number().int().min(0).max(3).optional()},
    annotations:ann(true,false,true)
  },tracked('light_remote_list_directory',identity,async input=>submitFs({sessionId:input.sessionId,agentId:input.agentId,operationId:`list-${crypto.randomUUID()}`,fs:{op:'list',path:input.path,maxEntries:input.maxEntries,maxDepth:input.maxDepth||0}})));
  server.registerTool('light_remote_write_text_file',{
    title:'Write remote text file',
    description:'Rewrite or append UTF-8 text on the selected target. Supply a stable operationId so retries are idempotent.',
    inputSchema:{...baseInput,operationId:opId,path:textPath,content:z.string().max(8000000),mode:z.enum(['rewrite','append']).optional(),createParents:z.boolean().optional()},
    annotations:ann(false,true,true)
  },tracked('light_remote_write_text_file',identity,async input=>submitFs({sessionId:input.sessionId,agentId:input.agentId,operationId:input.operationId,fs:{op:'write',path:input.path,content:input.content,mode:input.mode||'rewrite',atomic:true,createParents:Boolean(input.createParents)}})));

  server.registerTool('light_remote_search_start',{
    title:'Start managed remote search',
    description:'Start an asynchronous native file-name or content search and return a Light Remote search handle immediately.',
    inputSchema:{...baseInput,operationId:opId,path:textPath,searchType:z.enum(['content','files']).optional(),pattern:z.string().min(1).max(4096),literalSearch:z.boolean().optional(),ignoreCase:z.boolean().optional(),filePattern:z.string().max(1024).optional(),contextLines:z.number().int().min(0).max(20).optional(),maxResults:z.number().int().min(1).max(1000).optional()},
    annotations:ann(true,false,true)
  },tracked('light_remote_search_start',identity,async input=>submitSearch({sessionId:input.sessionId,agentId:input.agentId,operationId:input.operationId,search:{op:'start',path:input.path,searchType:input.searchType||'content',pattern:input.pattern,literalSearch:Boolean(input.literalSearch),ignoreCase:input.ignoreCase!==false,filePattern:input.filePattern||'',contextLines:input.contextLines||0,maxResults:input.maxResults||200}})));

  server.registerTool('light_remote_search_results',{
    title:'Read managed remote search results',
    description:'Read bounded paginated results from a Light Remote search handle without blocking on the full scan.',
    inputSchema:{...baseInput,searchId:z.string().regex(/^ls_[A-Za-z0-9_-]{20,80}$/),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(500).optional()},
    annotations:ann(true,false,true)
  },tracked('light_remote_search_results',identity,async input=>submitSearch({sessionId:input.sessionId,agentId:input.agentId,operationId:`search-results-${crypto.randomUUID()}`,search:{op:'results',searchId:input.searchId,offset:input.offset||0,limit:input.limit||100}})));

  server.registerTool('light_remote_search_cancel',{
    title:'Cancel managed remote search',
    description:'Cancel one Light Remote search handle owned by the current session and agent.',
    inputSchema:{...baseInput,operationId:opId,searchId:z.string().regex(/^ls_[A-Za-z0-9_-]{20,80}$/)},
    annotations:ann(false,true,true)
  },tracked('light_remote_search_cancel',identity,async input=>submitSearch({sessionId:input.sessionId,agentId:input.agentId,operationId:input.operationId,search:{op:'cancel',searchId:input.searchId}})));

  server.registerTool('light_remote_process_start',{
    title:'Start managed remote process',
    description:'Start an interactive process and return a Light Remote process handle without waiting for completion.',
    inputSchema:{...baseInput,operationId:opId,script:z.string().min(1).max(1000000),cwd:textPath.optional(),timeoutMs:z.number().int().min(0).max(86400000).optional(),requiredCapabilities:z.array(z.string().min(1).max(80)).max(32).optional()},
    annotations:ann(false,true,true)
  },tracked('light_remote_process_start',identity,async input=>submitProcess({sessionId:input.sessionId,agentId:input.agentId,operationId:input.operationId,process:{op:'start',script:input.script,cwd:input.cwd,timeoutMs:input.timeoutMs,requiredCapabilities:input.requiredCapabilities}})));

  server.registerTool('light_remote_process_input',{
    title:'Send input to managed remote process',
    description:'Write UTF-8 input to a running Light Remote process and optionally close stdin.',
    inputSchema:{...baseInput,operationId:opId,processId:z.string().regex(/^lp_[A-Za-z0-9_-]{20,80}$/),data:z.string().max(1048576).optional(),eof:z.boolean().optional()},
    annotations:ann(false,true,true)
  },tracked('light_remote_process_input',identity,async input=>submitProcess({sessionId:input.sessionId,agentId:input.agentId,operationId:input.operationId,process:{op:'input',processId:input.processId,data:input.data||'',eof:Boolean(input.eof)}})));

  server.registerTool('light_remote_process_output',{
    title:'Read managed remote process output',
    description:'Read bounded incremental stdout or stderr by byte offset from a Light Remote process.',
    inputSchema:{...baseInput,processId:z.string().regex(/^lp_[A-Za-z0-9_-]{20,80}$/),stream:z.enum(['stdout','stderr']).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(1048576).optional()},
    annotations:ann(true,false,true)
  },tracked('light_remote_process_output',identity,async input=>submitProcess({sessionId:input.sessionId,agentId:input.agentId,operationId:`process-output-${crypto.randomUUID()}`,process:{op:'output',processId:input.processId,stream:input.stream||'stdout',offset:input.offset||0,limit:input.limit||262144}})));

  server.registerTool('light_remote_process_list',{
    title:'List managed remote processes',
    description:'List Light Remote managed process handles owned by the current session and agent.',
    inputSchema:{...baseInput}, annotations:ann(true,false,true)
  },tracked('light_remote_process_list',identity,async input=>submitProcess({sessionId:input.sessionId,agentId:input.agentId,operationId:`process-list-${crypto.randomUUID()}`,process:{op:'list'}})));

  server.registerTool('light_remote_process_stop',{
    title:'Stop managed remote process',
    description:'Request graceful or forced termination of one Light Remote managed process handle.',
    inputSchema:{...baseInput,operationId:opId,processId:z.string().regex(/^lp_[A-Za-z0-9_-]{20,80}$/),force:z.boolean().optional()}, annotations:ann(false,true,true)
  },tracked('light_remote_process_stop',identity,async input=>submitProcess({sessionId:input.sessionId,agentId:input.agentId,operationId:input.operationId,process:{op:'stop',processId:input.processId,force:Boolean(input.force)}})));

  server.registerTool('light_remote_stat_path',{
    title:'Stat remote path', description:'Read bounded metadata for one remote path.',
    inputSchema:{...baseInput,path:textPath}, annotations:ann(true,false,true)
  },tracked('light_remote_stat_path',identity,async input=>submitFs({sessionId:input.sessionId,agentId:input.agentId,operationId:`stat-${crypto.randomUUID()}`,fs:{op:'stat',path:input.path}})));

  server.registerTool('light_remote_make_directory',{
    title:'Create remote directory', description:'Create a directory on the selected target. Retry with the same operationId.',
    inputSchema:{...baseInput,operationId:opId,path:textPath,parents:z.boolean().optional()}, annotations:ann(false,true,true)
  },tracked('light_remote_make_directory',identity,async input=>submitFs({sessionId:input.sessionId,agentId:input.agentId,operationId:input.operationId,fs:{op:'mkdir',path:input.path,parents:input.parents!==false}})));

  server.registerTool('light_remote_copy_path',{
    title:'Copy remote path', description:'Copy a file or directory on one target. Existing destination content may be replaced.',
    inputSchema:{...baseInput,operationId:opId,source:textPath,destination:textPath,overwrite:z.boolean().optional()}, annotations:ann(false,true,true)
  },tracked('light_remote_copy_path',identity,async input=>submitFs({sessionId:input.sessionId,agentId:input.agentId,operationId:input.operationId,fs:{op:'copy',source:input.source,destination:input.destination,overwrite:Boolean(input.overwrite)}})));

  server.registerTool('light_remote_move_path',{
    title:'Move remote path', description:'Move or rename a file or directory on one target.',
    inputSchema:{...baseInput,operationId:opId,source:textPath,destination:textPath,overwrite:z.boolean().optional()}, annotations:ann(false,true,true)
  },tracked('light_remote_move_path',identity,async input=>submitFs({sessionId:input.sessionId,agentId:input.agentId,operationId:input.operationId,fs:{op:'move',source:input.source,destination:input.destination,overwrite:Boolean(input.overwrite)}})));

  server.registerTool('light_remote_delete_path',{
    title:'Delete remote path', description:'Delete a file or directory on one target. Recursive directory deletion must be explicit.',
    inputSchema:{...baseInput,operationId:opId,path:textPath,recursive:z.boolean().optional()}, annotations:ann(false,true,true)
  },tracked('light_remote_delete_path',identity,async input=>submitFs({sessionId:input.sessionId,agentId:input.agentId,operationId:input.operationId,fs:{op:'delete',path:input.path,recursive:Boolean(input.recursive)}})));

}
