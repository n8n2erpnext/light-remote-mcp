import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const operatorHandler = require("../../api/operator.js");
function headersObject(headers: Headers) {
  const out: Record<string,string> = {};
  headers.forEach((value,key)=>{ out[key.toLowerCase()]=value; });
  return out;
}
export default async (request: Request) => {
  const url=new URL(request.url);
  let body:unknown=undefined;
  if(request.method!=="GET"&&request.method!=="HEAD"){
    const text=await request.text();
    if(text){try{body=JSON.parse(text)}catch{return Response.json({ok:false,error:"invalid_json_body"},{status:400})}}
  }
  let statusCode=200,responseBody="",completed=false;
  const responseHeaders=new Headers();
  const req:any={method:request.method,query:Object.fromEntries(url.searchParams.entries()),headers:headersObject(request.headers),body};
  const res:any={
    setHeader(n:string,v:string){responseHeaders.set(n,String(v));return res},
    status(c:number){statusCode=c;return res},
    json(v:unknown){responseHeaders.set("content-type","application/json; charset=utf-8");responseBody=JSON.stringify(v);completed=true;return res},
    send(v:unknown){responseBody=String(v??"");completed=true;return res},
    end(v?:unknown){responseBody=String(v??"");completed=true;return res}
  };
  await operatorHandler(req,res);
  if(!completed)return Response.json({ok:false,error:"bridge_no_response"},{status:500});
  return new Response(responseBody,{status:statusCode,headers:responseHeaders});
};
export const config={path:"/api/operator"};
