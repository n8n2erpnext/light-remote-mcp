import {createRequire} from "node:module";
const require=createRequire(import.meta.url),handler=require("./_shared/operator-handler.cjs");
function ho(h:Headers){const o:Record<string,string>={};h.forEach((v,k)=>o[k.toLowerCase()]=v);return o}
export default async(request:Request)=>{
 const u=new URL(request.url);let body:unknown=undefined;if(request.method!=="GET"&&request.method!=="HEAD"){const t=await request.text();if(t){try{body=JSON.parse(t)}catch{return Response.json({ok:false,error:"invalid_json_body"},{status:400})}}}
 let code=200,text="",done=false;const headers=new Headers(),req:any={method:request.method,query:Object.fromEntries(u.searchParams.entries()),headers:ho(request.headers),body};
 const res:any={setHeader(n:string,v:string){headers.set(n,String(v));return res},status(c:number){code=c;return res},json(v:unknown){headers.set("content-type","application/json; charset=utf-8");text=JSON.stringify(v);done=true;return res},send(v:unknown){text=String(v??"");done=true;return res},end(v?:unknown){text=String(v??"");done=true;return res}};
 await handler(req,res);if(!done)return Response.json({ok:false,error:"bridge_no_response"},{status:500});return new Response(text,{status:code,headers});
};
export const config={path:"/api/operator"};
