import {db} from "./_lib/db.js";import {cors,method,ipOf,sha256,body} from "./_lib/http.js";
const token=()=>crypto.randomUUID()+crypto.randomUUID();
export default async function handler(req,res){
 if(cors(req,res))return;if(!method(req,res,["GET","POST"]))return;
 try{
  const p=db();
  if(req.method==="GET"){
   const action=String(req.query.action||"");
   if(action==="my-votes"){const raw=String(req.query.token||"");if(!raw)return res.status(400).json({success:false,error:"token_required"});const h=await sha256(raw);const {rows}=await p.query("select napl_is_valid_rating_token($1) valid, napl_get_my_votes($1) votes",[h]);if(!rows[0].valid)return res.status(401).json({success:false,error:"invalid_token"});return res.json({success:true,votes:rows[0].votes||{}})}
   const {rows}=await p.query("select napl_get_ratings() data");return res.json(rows[0].data||{ports:[],global_avg:0});
  }
  const pathAction=Array.isArray(req.query.path)?req.query.path[0]:req.query.path;const b=body(req),action=String(b.action||req.query.action||pathAction||"");
  if(action==="token"){
   const raw=token(),th=await sha256(raw),ih=await sha256(ipOf(req));
   const {rows}=await p.query("select napl_issue_rating_token($1,$2) allowed",[ih,th]);
   if(!rows[0].allowed)return res.status(429).json({success:false,error:"rate_limited"});
   return res.json({success:true,token:raw});
  }
  if(action==="my-votes"){
   const raw=String(b.token||"");if(!raw)return res.status(400).json({success:false,error:"token_required"});
   const h=await sha256(raw);const {rows}=await p.query("select napl_is_valid_rating_token($1) valid,napl_get_my_votes($1) votes",[h]);
   if(!rows[0].valid)return res.status(401).json({success:false,error:"invalid_token"});return res.json({success:true,votes:rows[0].votes||{}});
  }
  if(action==="vote"){
   const raw=String(b.token||"");const port=String(b.port_id||b.portId||"");const stars=Number(b.stars);
   if(!raw||!port||!Number.isInteger(stars))return res.status(400).json({success:false,error:"invalid_vote"});
   const h=await sha256(raw);const {rows}=await p.query("select napl_is_valid_rating_token($1) valid",[h]);if(!rows[0].valid)return res.status(401).json({success:false,error:"invalid_token"});
   const saved=await p.query("select napl_submit_vote($1,$2,$3) data",[port,h,stars]);return res.json({success:true,...saved.rows[0].data});
  }
  return res.status(400).json({success:false,error:"unknown_action"});
 }catch(e){console.error("ratings",e);return res.status(500).json({success:false,error:e.message==="rate_limited"?"rate_limited":"Could not process ratings."})}
}
