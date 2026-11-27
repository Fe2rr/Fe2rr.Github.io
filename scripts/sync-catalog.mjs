import worker from "../cloudflare/napl-admin-worker.js";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const env={
  ADMIN_PASSWORD:process.env.ADMIN_PASSWORD,
  SESSION_SECRET:process.env.SESSION_SECRET,
  GITHUB_TOKEN:process.env.GITHUB_TOKEN||process.env.CATALOG_DATA_GITHUB_TOKEN,
  CATALOG_DATA_GITHUB_TOKEN:process.env.CATALOG_DATA_GITHUB_TOKEN,
  ADMIN_ORIGIN:"https://napl-admin.pages.dev",
  CRON_BATCH_SIZE:"15",
  AUTO_PUBLISH_CRON:""
};
for(const key of ["ADMIN_PASSWORD","SESSION_SECRET","GITHUB_TOKEN","CATALOG_DATA_GITHUB_TOKEN"])if(!env[key])throw new Error(`Missing required secret: ${key}`);

const origin="https://napl-admin.pages.dev";
let token="";
async function call(path,method="GET",body={}){
 const headers=new Headers({Origin:origin,Accept:"application/json"});
 if(method!=="GET")headers.set("Content-Type","application/json");
 if(token)headers.set("Authorization",`Bearer ${token}`);
 const req=new Request(`https://napl-internal/api/${path}`,{method,headers,body:method==="GET"?undefined:JSON.stringify(body)});
 const response=await worker.fetch(req,env);
 const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{}}catch{}
 if(!response.ok)throw new Error(`/${path} HTTP ${response.status}: ${data.error||raw}`);
 return data;
}
async function retry(fn,label,attempts=3){
 let last;for(let i=1;i<=attempts;i++){try{return await fn()}catch(e){last=e;console.warn(`${label} attempt ${i}/${attempts}: ${e.message}`);if(i<attempts)await new Promise(r=>setTimeout(r,1500*2**(i-1)))}}
 throw last;
}

const login=await retry(()=>call("login","POST",{password:env.ADMIN_PASSWORD}),"admin login");
token=login.token;if(!token)throw new Error("Worker did not issue an admin session.");
console.log("Authenticated against the existing catalog logic.");

if(process.env.IMPORT_SHEETS==="true"){
 const imported=await retry(()=>call("import-sheets","POST",{compact:true}),"Google Sheets import");
 console.log("Sheets import:",JSON.stringify(imported.summary||{}));
}else console.log("Google Sheets import skipped (safe default).");

let offset=0,totalChecked=0,totalUpdated=0,totalErrors=0,batches=0;
while(true){
 const result=await retry(()=>call("sync-sources","POST",{source:"github-actions",limit:15,offset,useOffset:true,stageOnly:true,compact:true,includeCatalog:false}),`sync batch at offset ${offset}`);
 const s=result.sync||{};
 batches++;totalChecked+=Number(s.checkedCount)||0;totalUpdated+=Number(s.updatedCount)||0;totalErrors+=Number(s.errorCount)||0;
 console.log(`Batch ${batches}: checked=${s.checkedCount||0}, updated=${s.updatedCount||0}, errors=${s.errorCount||0}, next=${s.nextOffset}, more=${Boolean(s.hasMore)}`);
 if(!s.hasMore)break;
 const next=Number(s.nextOffset);if(!Number.isFinite(next)||next<=offset)throw new Error("Sync offset did not advance; aborting to prevent an infinite loop.");
 offset=next;
}
const applied=await retry(()=>call("sync-apply","POST",{}),"apply staged sync");
console.log("Staged sync applied:",JSON.stringify({success:applied.success,updated:applied.updatedCount||applied.updated||null}));
const published=await retry(()=>call("publish","POST",{}),"publish catalog");
if(published.success===false||published.dataPublishError)throw new Error(published.dataPublishError||published.publishError||"Catalog publish failed.");
console.log("Catalog published to Fe2rr/NAPL-Data.");
const dataDir=process.env.NAPL_DATA_DIR;
if(dataDir){
 const state=await retry(()=>call("catalog","GET"),"read published catalog");
 const catalog=state.catalog||state;
 const allowedHosts=new Set(["images.launchbox-app.com","gamesdb-images.launchbox.gg","shared.fastly.steamstatic.com","shared.akamai.steamstatic.com","cdn.cloudflare.steamstatic.com","cdn.akamai.steamstatic.com","steamcdn-a.akamaihd.net","img.itch.zone","itch.zone","static.itch.io"]);
 const sources=new Set();
 for(const game of catalog.games||[]){
  if(game.coverUrl)sources.add(String(game.coverUrl).trim());
  for(const port of game.ports||[])if(port.coverUrl)sources.add(String(port.coverUrl).trim());
 }
 const coversDir=path.join(dataDir,"public","assets","covers");
 await fs.mkdir(coversDir,{recursive:true});
 const covers={};let generated=0,skipped=0,failed=0;
 const queue=[...sources].filter(Boolean);let cursor=0;
 async function optimize(source){
  let parsed;try{parsed=new URL(source)}catch{return}
  if(!["http:","https:"].includes(parsed.protocol)||!allowedHosts.has(parsed.hostname.toLowerCase()))return;
  const name=createHash("sha256").update(source).digest("hex").slice(0,24)+".webp";
  const file=path.join(coversDir,name);
  try{await fs.access(file);covers[source]=`https://napl-catalog.pages.dev/assets/covers/${name}`;skipped++;return}catch{}
  for(let attempt=1;attempt<=3;attempt++){
   try{
    const u=new URL("https://wsrv.nl/");u.searchParams.set("url",source);u.searchParams.set("output","webp");u.searchParams.set("w","240");u.searchParams.set("q","82");
    const response=await fetch(u,{headers:{Accept:"image/webp,image/*;q=0.8"}});
    if(!response.ok)throw new Error(`wsrv.nl HTTP ${response.status}`);
    const type=String(response.headers.get("content-type")||"").toLowerCase();
    if(!type.startsWith("image/"))throw new Error("wsrv.nl did not return an image");
    const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length<512)throw new Error("Optimized image is unexpectedly small");
    await fs.writeFile(file,bytes);covers[source]=`https://napl-catalog.pages.dev/assets/covers/${name}`;generated++;return;
   }catch(e){if(attempt===3){failed++;console.warn("Cover optimization skipped:",source,e.message)}else await new Promise(r=>setTimeout(r,500*attempt))}
  }
 }
 const workers=Array.from({length:4},async()=>{while(cursor<queue.length){const source=queue[cursor++];await optimize(source)}});
 await Promise.all(workers);
 const manifestPath=path.join(coversDir,"manifest.json");
 await fs.writeFile(manifestPath,JSON.stringify({version:1,generatedAt:new Date().toISOString(),covers},null,2)+"\n");
 console.log(`Cover pipeline: ${generated} generated, ${skipped} cached, ${failed} failed, ${sources.size} source URLs.`);
}
console.log(JSON.stringify({batches,totalChecked,totalUpdated,totalErrors,completedAt:new Date().toISOString()},null,2));
if(totalErrors>0)console.warn("Sync completed with provider errors; inspect workflow logs.");
