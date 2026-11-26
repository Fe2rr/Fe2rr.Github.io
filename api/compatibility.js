import {db} from "./_lib/db.js";import {cors,method,body,sha256} from "./_lib/http.js";
const statuses=new Set(["crash","low_fps","playable_30","playable_60"]);
export default async function handler(req,res){
 if(cors(req,res))return;if(!method(req,res,["GET","POST"]))return;
 try{const p=db();if(req.method==="GET"){
 const action=String(req.query.action||"");
 if(action==="devices")return res.status(410).json({success:false,error:"The device catalog is served from static JSON."})
 if(action==="search"){const id=String(req.query.device_id||"").slice(0,200),soc=String(req.query.soc||"").slice(0,120),q=String(req.query.q||"").slice(0,120),limit=Math.min(Math.max(Number(req.query.limit)||500,1),1000);const {rows}=await p.query("select get_compatibility_by_hardware($1,$2,$3,$4) data",[id||null,soc||null,q||null,limit]);res.setHeader("Cache-Control","public, max-age=20, s-maxage=40");return res.json({success:true,reports:rows[0].data||[]})}
 const ids=[...new Set(String(req.query.port_ids||"").split(",").map(x=>x.trim()).filter(Boolean))].slice(0,50);if(ids.some(x=>x.length>120))return res.status(400).json({success:false,error:"Invalid port ID."});const {rows}=await p.query("select get_compatibility_for_ports($1::text[]) data",[ids]);res.setHeader("Cache-Control","public, max-age=30, s-maxage=60");return res.json({success:true,compatibility:rows[0].data||{}});
 }
 const b=body(req),port=String(b.port_id||"").trim(),device=String(b.device_id||"").trim(),raw=String(b.token||"").trim(),status=String(b.status||"").trim(),works=typeof b.works==="boolean"?b.works:b.works===1?true:b.works===0?false:null;const s=statuses.has(status)?status:works===true?"playable_30":works===false?"crash":"";
 if(!port||port.length>120||!device||device.length>200||!raw||raw.length>512||!s)return res.status(400).json({success:false,error:"port_id, device_id, token, and a valid status are required."});
 const h=await sha256(raw);const {rows}=await p.query("select upsert_compatibility_report($1,$2,$3,$4,$5) data",[port,h,device,s==="playable_30"||s==="playable_60",s]);res.setHeader("Cache-Control","no-store");return res.json({success:true,report:rows[0].data.report||null,summary:rows[0].data.summary||null});
 }catch(e){console.error("compatibility",e);return res.status(500).json({success:false,error:"Could not process compatibility data."})}
}
