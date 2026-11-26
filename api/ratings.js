import {db} from "./_lib/db.js";
import {cors,method,ipOf,sha256,body} from "./_lib/http.js";

const TOKEN_RE=/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\\.([A-Za-z0-9_-]{40,50}))?$/i;
const PORT_ID_RE=/^[a-z0-9][a-z0-9|._-]{0,119}$/i;

async function hashVoterToken(value){
 if(typeof value!=="string"||value.length>200)throw new Error("invalid_token");
 const match=value.match(TOKEN_RE);if(!match)throw new Error("invalid_token");
 return sha256(match[1].toLowerCase());
}
async function dailyIpHash(req){
 const forwarded=String(req.headers["x-forwarded-for"]||"").split(",")[0].trim();
 const ip=String(req.headers["cf-connecting-ip"]||req.headers["x-real-ip"]||forwarded||"unknown");
 const day=new Date().toISOString().slice(0,10);
 return sha256(ip+":"+day);
}
export default async function handler(req,res){
 if(cors(req,res))return;
 if(!method(req,res,["GET","POST"]))return;
 try{
  const p=db();
  const pathAction=Array.isArray(req.query?.path)?req.query.path[0]:req.query?.path;
  if(req.method==="GET"){
   if(pathAction==="my-votes"||req.query.action==="my-votes"){
    const raw=String(req.query.token||"");const h=await hashVoterToken(raw);
    const {rows}=await p.query("select napl_is_valid_rating_token($1) valid,napl_get_my_votes($1) votes",[h]);
    if(!rows[0].valid)return res.status(401).json({error:"invalid_token"});
    return res.setHeader("Cache-Control","no-store"),res.json({votes:rows[0].votes||{}});
   }
   const {rows}=await p.query("select napl_get_ratings() data");
   res.setHeader("Cache-Control","public, max-age=30, s-maxage=60");
   return res.json(rows[0].data||{ports:[],global_avg:0});
  }
  const b=body(req),action=String(b.action||req.query?.action||pathAction||"");
  if(Buffer.byteLength(JSON.stringify(b))>2048)return res.status(413).json({error:"body_too_large"});
  if(action==="token"){
   const raw=crypto.randomUUID(),th=await hashVoterToken(raw),ih=await dailyIpHash(req);
   const {rows}=await p.query("select napl_issue_rating_token($1,$2) allowed",[ih,th]);
   if(rows[0].allowed!==true)return res.status(429).json({error:"rate_limited"});
   res.setHeader("Cache-Control","no-store");return res.json({token:raw});
  }
  const tokenHash=await hashVoterToken(b.token);
  const valid=await p.query("select napl_is_valid_rating_token($1) valid",[tokenHash]);
  if(valid.rows[0].valid!==true)return res.status(401).json({error:"invalid_token"});
  if(action==="my-votes"){
   const {rows}=await p.query("select napl_get_my_votes($1) votes",[tokenHash]);
   res.setHeader("Cache-Control","no-store");return res.json({votes:rows[0].votes||{}});
  }
  if(action==="vote"||action==="unvote"){
   const portId=typeof b.port_id==="string"?b.port_id.trim():"";
   if(!PORT_ID_RE.test(portId))return res.status(400).json({error:"invalid_port_id"});
   if(action==="unvote"){
    const {rows}=await p.query("select napl_remove_vote($1,$2) data",[portId,tokenHash]);
    res.setHeader("Cache-Control","no-store");return res.json(rows[0].data||{ok:true,port_id:portId});
   }
   const stars=b.stars;
   if(!Number.isInteger(stars)||Number(stars)<1||Number(stars)>5)return res.status(400).json({error:"invalid_stars"});
   const {rows}=await p.query("select napl_submit_vote($1,$2,$3) data",[portId,tokenHash,Number(stars)]);
   res.setHeader("Cache-Control","no-store");return res.json(rows[0].data||{ok:true,port_id:portId,stars});
  }
  return res.status(404).json({error:"not_found"});
 }catch(e){
  const message=String(e?.message||"");
  if(message==="invalid_token")return res.status(401).json({error:"invalid_token"});
  if(message==="rate_limited")return res.status(429).json({error:"rate_limited"});
  if(message==="invalid_request")return res.status(400).json({error:"invalid_request"});
  console.error("ratings",e);return res.status(500).json({error:"server_error"});
 }
}
