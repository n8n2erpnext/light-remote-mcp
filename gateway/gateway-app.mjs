import express from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';

export const DEFAULT_DEVICE_RESULT_BODY_LIMIT='8mb';

export function createLightRemoteGatewayApp({host='127.0.0.1',allowedHosts,deviceResultLimit=DEFAULT_DEVICE_RESULT_BODY_LIMIT}={}){
  const app=express(),regularJson=express.json(),deviceResultJson=express.json({limit:deviceResultLimit});
  app.use((req,res,next)=>{
    const pathname=String(req.path||new URL(req.originalUrl||req.url||'/','http://light.remote').pathname);
    const parser=req.method==='POST'&&pathname==='/device-channel/result'?deviceResultJson:regularJson;
    return parser(req,res,next);
  });
  app.use(createMcpExpressApp({host,allowedHosts}));
  return app;
}
