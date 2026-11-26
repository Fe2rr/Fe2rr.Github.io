import worker from "../cloudflare/napl-admin-worker.js";
const DATA_REPO=process.env.NAPL_DATA_REPO||"Fe2rr/NAPL-Data";
const WORKFLOW=process.env.NAPL_SYNC_WORKFLOW||"sync-catalog.yml";
const ORIGIN_DEFAULTS=["https://fe2rr.github.io","https://napl-admin.pages.dev"];
function envForWorker(){return {ADMIN_PASSWORD:process.env.ADMIN_PASSWORD,SESSION_SECRET:process.env.SESSION_SECRET,GITHUB_TOKEN:process.env.GITHUB_TOKEN,CATALOG_DATA_GITHUB_TOKEN:process.env.CATALOG_DATA_GITHUB_TOKEN,ADMIN_ORIGIN:process.env.ALLOWED_ORIGINS||ORIGIN_DEFAULTS.join(","),AUTO_PUBLISH_CRON:"",CRON_BATCH_SIZE:"10"}}
function pathOf(req){const p=req.query?.path;return Array.isArray(p)?p.join("/"):String(p||"")}
function setSecurity(res){res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("X-Frame-Options","DENY");res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");res.setHeader("Strict-Transport-Security","max-age=31536000; includeSubDomains")}
function setCors(req,res){
 const origin=String(req.headers.origin||"");
 const allowed=(process.env.ALLOWED_ORIGINS||ORIGIN_DEFAULTS.join(",")).split(",").map(x=>x.trim()).filter(Boolean);
 res.setHeader("Vary","Origin");
 res.setHeader("Access-Control-Allow-Methods","GET,POST,PUT,DELETE,OPTIONS");
 res.setHeader("Access-Control-Allow-Headers","Content-Type,Authorization");
 res.setHeader("Access-Control-Max-Age","86400");
 if(origin&&allowed.includes(origin))res.setHeader("Access-Control-Allow-Origin",origin);
 if(req.method==="OPTIONS"){res.status(204).end();return true}
 if(origin&&!allowed.includes(origin)){res.status(403).json({error:"Origin not allowed"});return true}
 return false;
}
async function workerCall(req,path,token,method=req.method){const headers=new Headers({Origin:String(req.headers.origin||"https://napl-admin.pages.dev"),"Content-Type":"application/json"});if(token)headers.set("Authorization",token.startsWith("Bearer ")?token:`Bearer ${token}`);const body=["GET","HEAD"].includes(req.method)?undefined:JSON.stringify(req.body||{});const request=new Request(`https://napl-internal/api/${path}`,{method,headers,body:method==="GET"||method==="HEAD"?undefined:body});return worker.fetch(request,envForWorker())}
async function github(path,options={}){const token=process.env.GH_ACTIONS_TOKEN||process.env.GITHUB_TOKEN;if(!token)throw new Error("GH_ACTIONS_TOKEN is not configured");const r=await fetch(`https://api.github.com${path}`,{...options,headers:{Accept:"application/vnd.github+json",Authorization:`Bearer ${token}`,"X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json",...(options.headers||{})}});const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{}if(!r.ok)throw new Error(data.message||`GitHub API HTTP ${r.status}`);return data}
async function dispatchWorkflow(importSheets=false){
 const runs=await github(`/repos/Fe2rr/Napl-prueba/actions/workflows/${WORKFLOW}/runs?per_page=5`);
 const active=(runs.workflow_runs||[]).find(r=>r.status==="queued"||r.status==="in_progress");
 if(active)return {queued:true,alreadyRunning:true,runId:active.id,runUrl:active.html_url};
 await github(`/repos/Fe2rr/Napl-prueba/actions/workflows/${WORKFLOW}/dispatches`,{method:"POST",body:JSON.stringify({ref:"main",inputs:{import_sheets:String(Boolean(importSheets))}})});
 return {alreadyRunning:false,queued:true,workflow:WORKFLOW};
}
export default async function handler(req,res){
 setSecurity(res);
 if(setCors(req,res))return;
 const path=pathOf(req);
 try{
  if(path==="sync-trigger"&&req.method==="POST"){
   const auth=await workerCall(req,"verify-session",req.headers.authorization||"","GET");
   if(!auth.ok)return res.status(auth.status).json(await auth.json());
   const result=await dispatchWorkflow(req.body?.import_sheets===true);
   return res.status(202).json({success:true,...result});
  }
  if(path==="sync-status"&&req.method==="GET"){
   const auth=await workerCall(req,"verify-session",req.headers.authorization||"");
   if(!auth.ok)return res.status(auth.status).json(await auth.json());
   const runs=await github(`/repos/Fe2rr/Napl-prueba/actions/workflows/${WORKFLOW}/runs?per_page=5`);
   return res.json({success:true,runs:(runs.workflow_runs||[]).map(r=>({id:r.id,status:r.status,conclusion:r.conclusion,html_url:r.html_url,created_at:r.created_at,updated_at:r.updated_at}))});
  }
  if((path==="sync-sources"||path==="sync-github"||path==="sync-queue")&&req.method==="POST"){
   const auth=await workerCall(req,"verify-session",req.headers.authorization||"","GET");
   if(!auth.ok)return res.status(auth.status).json(await auth.json());
   const result=await dispatchWorkflow(req.body?.import_sheets===true);
   return res.status(202).json({success:true,...result});
  }
  const upstream=await workerCall(req,path,req.headers.authorization||"");
  const raw=await upstream.text();
  upstream.headers.forEach((v,k)=>{if(["content-type","cache-control","access-control-allow-origin","access-control-allow-methods","access-control-allow-headers","vary"].includes(k.toLowerCase()))res.setHeader(k,v)});
  res.status(upstream.status);
  return res.send(raw);
 }catch(e){console.error("NAPL API",e);return res.status(500).json({error:e.message||"Internal server error"})}
}
