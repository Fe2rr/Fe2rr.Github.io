import {db} from "./_lib/db.js";import {cors,method,body,ipOf,hmac} from "./_lib/http.js";
const reasons=["Dead / 404 link","Wrong game or version","Requires account / paywall","Suspicious / broken file"];
export default async function handler(req,res){
 if(cors(req,res))return;if(!method(req,res,["POST"]))return;
 try{const raw=JSON.stringify(body(req));if(Buffer.byteLength(raw)>2048)return res.status(413).json({success:false,error:"body_too_large"});
 const b=body(req),port=String(b.port_id||"").trim().slice(0,120),reason=String(b.reason||"").replace(/\s+/g," ").trim().slice(0,120),note=String(b.note||"").replace(/\s+/g," ").trim().slice(0,500),client=String(b.client_id||"").trim(),url=String(b.url||"").trim().slice(0,500);
 const validReason=reasons.includes(reason),validCustomNote=!reason&&note.length>=3;
 if(!/^[a-z0-9][a-z0-9|._-]{0,119}$/i.test(port)||(!validReason&&!validCustomNote)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(client))return res.status(400).json({success:false,error:"Invalid report details."});
 let normalized="";if(url){try{const u=new URL(url);if(!["https:","http:"].includes(u.protocol))throw 0;normalized=u.toString()}catch{return res.status(400).json({success:false,error:"Invalid report URL."})}}
 if(!process.env.DISCORD_WEBHOOK_URL)return res.status(503).json({success:false,error:"Discord webhook is not configured yet."});
 const reporter=await hmac(client+":"+ipOf(req)),p=db();const {rows}=await p.query("select napl_reserve_link_report($1) data",[reporter]);const reservation=rows[0].data;if(!reservation.allowed){const retry=Math.max(1,Number(reservation.retry_after_seconds)||600);res.setHeader("Retry-After",String(retry));return res.status(429).json({success:false,error:`You can submit another report in ${Math.ceil(retry/60)} minute(s).`,retry_after_seconds:retry})}
 const display=reason||"Custom note";await p.query("insert into link_reports(port_id,reporter_hash,reason,note,url,updated_at) values($1,$2,$3,$4,$5,now()) on conflict(port_id,reporter_hash) do update set reason=excluded.reason,note=excluded.note,url=excluded.url,updated_at=now()",[port,reporter,display,note,normalized]);
 let notified=false;if(process.env.DISCORD_WEBHOOK_URL){try{const r=await fetch(process.env.DISCORD_WEBHOOK_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({allowed_mentions:{parse:[]},embeds:[{title:"NAPL — Broken Link Report",color:15158332,fields:[{name:"Port ID",value:port},{name:"Reason",value:display},{name:"Note",value:note||"N/A"},{name:"URL",value:normalized||"N/A"}],timestamp:new Date().toISOString()}]})});notified=r.ok}catch(e){console.error("Discord notification",e)}}
 return res.json({success:true,portId:port,reason:display,note,notification_sent:notified});
 }catch(e){console.error("report-link",e);return res.status(500).json({success:false,error:"Could not process the report."})}
}
