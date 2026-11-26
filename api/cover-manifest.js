import {cors,method} from "./_lib/http.js";
export default async function handler(req,res){
 if(cors(req,res))return;
 if(!method(req,res,["GET"]))return;
 try{
  const upstream=await fetch("https://napl-catalog.pages.dev/assets/covers/manifest.json",{headers:{Accept:"application/json"},signal:AbortSignal.timeout(5000)});
  if(!upstream.ok)return res.status(404).json({version:1,covers:{}});
  const manifest=await upstream.json();
  res.setHeader("Cache-Control","public, max-age=300, s-maxage=1800, stale-while-revalidate=86400");
  return res.json(manifest&&typeof manifest.covers==="object"?manifest:{version:1,covers:{}});
 }catch(e){console.warn("Cover manifest unavailable:",e.message);return res.status(200).json({version:1,covers:{}})}
}
