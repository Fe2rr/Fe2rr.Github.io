import {db} from "./_lib/db.js";
import {cors,method,body,sha256} from "./_lib/http.js";
async function dailyIpHash(req){
 const forwarded=String(req.headers["x-forwarded-for"]||"").split(",")[0].trim();
 const ip=String(req.headers["cf-connecting-ip"]||req.headers["x-real-ip"]||forwarded||"unknown");
 const day=new Date().toISOString().slice(0,10);
 return sha256(ip+":"+day);
}
export default async function handler(req,res){
 if(cors(req,res))return;if(!method(req,res,["GET","POST"]))return;
 try{
  const p=db();
  if(req.method==="GET"){
   const period=String(req.query.period||"week").toLowerCase();
   if(!["week","month","alltime"].includes(period))return res.status(400).json({error:"invalid_period"});
   const {rows}=await p.query("select * from napl_get_popularity($1)",[period]);
   res.setHeader("Cache-Control","public, max-age=20, s-maxage=30");
   return res.json({success:true,period,games:rows.map(r=>({slug:r.slug,visits:Number(r.visits)||0}))});
  }
  const b=body(req);if(Buffer.byteLength(JSON.stringify(b))>1024)return res.status(413).json({error:"body_too_large"});
  const key=typeof b.game==="string"?b.game.trim().toLowerCase():"";
  if(!/^[a-z0-9][a-z0-9-]{0,179}$/.test(key))return res.status(400).json({error:"invalid_game"});
  const {rows}=await p.query("select napl_register_game_visit($1,$2) accepted",[key,await dailyIpHash(req)]);
  res.setHeader("Cache-Control","no-store");
  return res.json({success:true,counted:rows[0].accepted===true});
 }catch(e){console.error("popularity",e);return res.status(500).json({error:"server_error"})}
}
