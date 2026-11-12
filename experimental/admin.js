const DATA_URL = "./data/ports.json";
const STORAGE_KEY = "napl-experimental-ports-v1";
const $ = s => document.querySelector(s);
let ports = [];
const fields = {
  GAME:"game", PLATFORM:"platform", PROJECT:"project", DEVELOPER:"developer", LINK:"link", URL:"url", VERSION:"version", "LAST UPDATE":"updated", GENRE:"genre", YEAR:"year", COVER_URL:"cover", DESCRIPTION:"description", NOTES:"notes"
};
const esc = v => String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const isTrue = v => v===true || v==="true" || v===1 || v==="1";
async function init(){
  const response = await fetch(DATA_URL);
  const json = await response.json();
  ports = json.ports || json;
  const saved = localStorage.getItem(STORAGE_KEY);
  if(saved) ports = JSON.parse(saved);
  refresh();
}
function persist(){ localStorage.setItem(STORAGE_KEY,JSON.stringify(ports)); refresh(); }
function refresh(){
  const platforms=[...new Set(ports.map(p=>p.PLATFORM).filter(Boolean))].sort();
  $("#admin-platform").innerHTML='<option value="">All platforms</option>'+platforms.map(p=>`<option>${esc(p)}</option>`).join("");
  $("#admin-total").textContent=ports.length;
  $("#admin-platforms").textContent=platforms.length;
  $("#admin-working").textContent=ports.filter(p=>isTrue(p["WORKS?"])).length;
  renderRows();
}
function renderRows(){
  const q=$("#admin-search").value.toLowerCase(), platform=$("#admin-platform").value;
  const list=ports.filter(p=>(!platform||p.PLATFORM===platform)&&[p.GAME,p.PROJECT,p.DEVELOPER,p.PLATFORM].join(" ").toLowerCase().includes(q));
  $("#admin-rows").innerHTML=list.map(p=>`<tr><td><strong>${esc(p.GAME)}</strong><small>${esc(p.PROJECT||p.DEVELOPER||"No project name")}</small></td><td>${esc(p.PLATFORM)}</td><td>${esc(p.VERSION||"—")}</td><td><span class="status-tag ${isTrue(p["WORKS?"])?"":"off"}">${isTrue(p["WORKS?"])?"● WORKS":"○ UNCONFIRMED"}</span></td><td>#${esc(p.PORTS_ID)}</td><td><div class="row-actions"><button data-edit="${p.PORTS_ID}">Edit</button></div></td></tr>`).join("");
  $("#admin-empty").hidden=list.length>0;
  $("#admin-rows").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>openForm(Number(b.dataset.edit))));
}
function openForm(id=null){
  const p=ports.find(x=>Number(x.PORTS_ID)===id)||{};
  $("#port-form").reset();
  $("#field-id").value=id??"";
  $("#form-title").textContent=id?"Edit port":"Add port";
  $("#delete-port").hidden=!id;
  Object.entries(fields).forEach(([key,field])=>{const el=$("#field-"+field);if(el)el.value=p[key]??"";});
  $("#field-works").checked=isTrue(p["WORKS?"]);
  $("#field-controller").checked=isTrue(p["CONTROLLER SUPPORT"]);
  $("#field-files").checked=isTrue(p["NEEDS GAME FILES?"]);
  $("#edit-dialog").showModal();
}
function nextId(){return Math.max(0,...ports.map(p=>Number(p.PORTS_ID)||0))+1;}
$("#add-port").addEventListener("click",()=>openForm());
$("#form-close").addEventListener("click",()=>$("#edit-dialog").close());
$("#cancel-form").addEventListener("click",()=>$("#edit-dialog").close());
$("#admin-search").addEventListener("input",renderRows);
$("#admin-platform").addEventListener("change",renderRows);
$("#port-form").addEventListener("submit",e=>{
  e.preventDefault();
  const oldId=$("#field-id").value;
  const current=ports.find(p=>Number(p.PORTS_ID)===Number(oldId))||{};
  const item={...current,PORTS_ID:oldId?Number(oldId):nextId()};
  Object.entries(fields).forEach(([key,field])=>item[key]=$("#field-"+field).value.trim());
  item.YEAR=item.YEAR?Number(item.YEAR):"";
  item["WORKS?"]=$("#field-works").checked;
  item["CONTROLLER SUPPORT"]=$("#field-controller").checked;
  item["NEEDS GAME FILES?"]=$("#field-files").checked;
  item["DATE ADDED"]=current["DATE ADDED"]||new Date().toISOString().replace("T"," ").slice(0,19);
  item.VISITAS=Number(current.VISITAS||0);
  const idx=ports.findIndex(p=>Number(p.PORTS_ID)===item.PORTS_ID);
  if(idx>=0)ports[idx]=item;else ports.unshift(item);
  persist();$("#edit-dialog").close();
});
$("#delete-port").addEventListener("click",()=>{
  const id=Number($("#field-id").value);
  if(!id||!confirm("Delete this port from the local experimental catalog?"))return;
  ports=ports.filter(p=>Number(p.PORTS_ID)!==id);persist();$("#edit-dialog").close();
});
$("#export-json").addEventListener("click",()=>{
  const blob=new Blob([JSON.stringify({schemaVersion:1,updatedAt:new Date().toISOString(),ports},null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="napl-ports-export.json";a.click();URL.revokeObjectURL(url);
});
$("#import-json").addEventListener("change",async e=>{
  const file=e.target.files[0];if(!file)return;
  try{const data=JSON.parse(await file.text());const incoming=Array.isArray(data)?data:data.ports;if(!Array.isArray(incoming))throw new Error("Missing ports array");if(!confirm(`Replace the local catalog with ${incoming.length} imported ports?`))return;ports=incoming;persist();}catch(err){alert("Import failed: "+err.message);}finally{e.target.value="";}
});
init().catch(err=>{console.error(err);$("#admin-rows").innerHTML='<tr><td colspan="6">Could not load demo catalog.</td></tr>';});