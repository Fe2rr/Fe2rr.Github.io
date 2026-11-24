/* NAPL popularity service — Supabase-backed. */
import { createSlug } from "./helpers.js";
import { POPULARITY_API_BASE } from "./config.js";
const popularByPeriod=new Map();
const popularPromises=new Map();
async function requestPopularity(period){
 const response=await fetch(`${POPULARITY_API_BASE}?period=${encodeURIComponent(period)}`,{method:"GET",cache:"no-store"});
 if(!response.ok)throw new Error(`Popularity API returned HTTP ${response.status}.`);
 const data=await response.json();
 if(!data?.success||!Array.isArray(data.games))throw new Error("Invalid popularity response.");
 return data.games;
}
export async function ensurePopularPeriod(period="alltime"){
 const normalized=String(period||"alltime").trim().toLowerCase();
 if(!["week","month","alltime"].includes(normalized))return new Map();
 if(popularByPeriod.has(normalized))return popularByPeriod.get(normalized);
 if(popularPromises.has(normalized))return popularPromises.get(normalized);
 const promise=requestPopularity(normalized).then(items=>{
  const map=new Map();
  for(const item of items){const visits=Number(item?.visits)||0;const slug=createSlug(item?.slug||"");if(slug)map.set(slug,visits);}
  popularByPeriod.set(normalized,map);return map;
 }).catch(error=>{console.warn(`Could not load ${normalized} popularity:`,error);return new Map();}).finally(()=>popularPromises.delete(normalized));
 popularPromises.set(normalized,promise);return promise;
}
export function getPopularVisits(gameName,period="alltime"){
 const key=createSlug(gameName||"");return popularByPeriod.get(String(period||"alltime").trim().toLowerCase())?.get(key)||0;
}
export async function refreshPopularPeriod(period="alltime"){
 const normalized=String(period||"alltime").trim().toLowerCase();
 if(!["week","month","alltime"].includes(normalized))return new Map();
 const items=await requestPopularity(normalized);
 const map=new Map();
 for(const item of items){const visits=Number(item?.visits)||0;const slug=createSlug(item?.slug||"");if(slug)map.set(slug,visits);}
 popularByPeriod.set(normalized,map);
 return map;
}
export async function ensureAllTimePopular(){return ensurePopularPeriod("alltime");}
export function getAllTimeVisits(gameName){return getPopularVisits(gameName,"alltime");}
export function registerGameVisit(gameName){
 const game=createSlug(gameName||"");if(!game)return;
 fetch(POPULARITY_API_BASE,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({game}),cache:"no-store",keepalive:true})
 .then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json();})
 .then(result=>{if(result?.counted)popularByPeriod.clear();})
 .catch(error=>console.warn("NAPL: could not register the game visit.",error));
}
