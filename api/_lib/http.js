const defaults=["https://fe2rr.github.io","https://napl-admin.pages.dev"];
export function cors(req,res){
 const origin=req.headers.origin||"";
 const allowed=(process.env.ALLOWED_ORIGINS||defaults.join(",")).split(",").map(x=>x.trim()).filter(Boolean);
 res.setHeader("Vary","Origin");
 if(allowed.includes(origin)){res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Access-Control-Allow-Credentials","true")}
 res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
 res.setHeader("Access-Control-Allow-Headers","Content-Type,Authorization");
 res.setHeader("Access-Control-Max-Age","86400");
 res.setHeader("X-Content-Type-Options","nosniff");
 res.setHeader("X-Frame-Options","DENY");
 res.setHeader("Strict-Transport-Security","max-age=31536000; includeSubDomains");
 res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
 res.setHeader("Cache-Control","no-store");
 if(req.method==="OPTIONS"){res.status(204).end();return true}
 if(origin&&!allowed.includes(origin)){res.status(403).json({success:false,error:"Origin not allowed"});return true}
 return false;
}
export function method(req,res,allowed){if(!allowed.includes(req.method)){res.setHeader("Allow",allowed.join(", "));res.status(405).json({success:false,error:"Method not allowed"});return false}return true}
export function ipOf(req){return String(req.headers["x-forwarded-for"]||req.headers["x-real-ip"]||"unknown").split(",")[0].trim()}
export async function sha256(value){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
export async function hmac(value){const secret=process.env.RATE_LIMIT_SECRET||process.env.SESSION_SECRET;if(!secret)throw new Error("RATE_LIMIT_SECRET is not configured");const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const b=await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(value));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
export function body(req){return req.body&&typeof req.body==="object"?req.body:{}}
