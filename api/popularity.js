import {db} from "./_lib/db.js";import {cors,method,ipOf,sha256,body} from "./_lib/http.js";
export default async function handler(req,res){
 if(cors(req,res))return;if(!method(req,res,["GET","POST"]))return;
 try{const p=db();if(req.method==="GET"){const period=String(req.query.period||"week");if(!["week","month","alltime"].includes(period))return res.status(400).json({success:false,error:"invalid_period"});const {rows}=await p.query("select * from napl_get_popularity($1)",[period]);return res.json({success:true,popularity:rows})}
 const b=body(req),key=String(b.game||b.game_key||"").trim().toLowerCase();if(!/^[a-z0-9][a-z0-9-]{0,179}$/.test(key))return res.status(400).json({success:false,error:"invalid_game"});
 const ih=await sha256(ipOf(req));const {rows}=await p.query("select napl_register_game_visit($1,$2) counted",[key,ih]);return res.json({success:true,counted:rows[0].counted});
 }catch(e){console.error("popularity",e);return res.status(500).json({success:false,error:"Could not process popularity."})}
}
