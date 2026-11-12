const DATA_URL = "./data/ports.json";
const STORAGE_KEY = "napl-experimental-ports-v1";
const $ = (selector) => document.querySelector(selector);
let ports = [];

const esc = (value = "") => String(value).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
const truthy = value => value === true || value === "true" || value === 1 || value === "1";
const safeUrl = value => { try { const url = new URL(value); return ["http:","https:"].includes(url.protocol) ? url.href : ""; } catch { return ""; } };

async function loadPorts() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load catalog");
    const payload = await response.json();
    ports = Array.isArray(payload) ? payload : payload.ports || [];
    const local = localStorage.getItem(STORAGE_KEY);
    if (local) ports = JSON.parse(local);
  } catch (error) {
    $("#port-grid").innerHTML = '<div class="loading-state">Catalog could not be loaded.</div>';
    return;
  }
  initializeFilters();
  render();
}

function initializeFilters() {
  const platforms = [...new Set(ports.map(p => p.PLATFORM).filter(Boolean))].sort();
  const genres = [...new Set(ports.map(p => p.GENRE).filter(Boolean))].sort();
  $("#platform-filter").innerHTML = '<option value="">All platforms</option>' + platforms.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join("");
  $("#genre-filter").innerHTML = '<option value="">All genres</option>' + genres.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join("");
  $("#stat-ports").textContent = ports.length.toLocaleString();
  $("#stat-platforms").textContent = platforms.length.toLocaleString();
  $("#stat-working").textContent = ports.filter(p => truthy(p["WORKS?"])).length.toLocaleString();
}

function render() {
  const query = $("#search-input").value.trim().toLowerCase();
  const platform = $("#platform-filter").value;
  const genre = $("#genre-filter").value;
  const sort = $("#sort-filter").value;
  let filtered = ports.filter(p => {
    const haystack = [p.GAME,p.PROJECT,p.DEVELOPER,p.PLATFORM,p.GENRE,p.DESCRIPTION].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!platform || p.PLATFORM === platform) && (!genre || p.GENRE === genre);
  });
  filtered.sort((a,b) => {
    if (sort === "name") return String(a.GAME).localeCompare(String(b.GAME));
    if (sort === "popular") return Number(b.VISITAS || 0) - Number(a.VISITAS || 0);
    const key = sort === "added" ? "DATE ADDED" : "LAST UPDATE";
    return String(b[key] || "").localeCompare(String(a[key] || ""));
  });
  $("#result-count").textContent = `${filtered.length} / ${ports.length} PORTS`;
  $("#active-filters").textContent = [platform,genre].filter(Boolean).join("  /  ");
  $("#port-grid").innerHTML = filtered.map(card).join("");
  $("#empty-state").hidden = filtered.length > 0;
  $("#port-grid").hidden = filtered.length === 0;
  $("#port-grid").querySelectorAll("[data-port-id]").forEach(el => el.addEventListener("click", () => openDetails(Number(el.dataset.portId))));
}

function card(port) {
  const cover = safeUrl(port.COVER_URL);
  const working = truthy(port["WORKS?"]);
  return `<article class="port-card" data-port-id="${Number(port.PORTS_ID)}" tabindex="0" role="button" aria-label="View ${esc(port.GAME)}">
    <div class="cover">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : `<span class="cover-placeholder">${esc((port.GAME || "N").slice(0,1).toUpperCase())}</span>`}
      <span class="cover-platform">${esc(port.PLATFORM || "Unknown platform")}</span><span class="cover-status">${working ? "● WORKS" : "○ UNTESTED / NO"}</span>
    </div>
    <div class="port-body"><div class="port-meta">${esc(port.GENRE || "UNCATEGORIZED")} ${port.YEAR ? " / " + esc(port.YEAR) : ""}</div><h3 class="port-title">${esc(port.GAME || "Untitled game")}</h3><div class="port-project">${esc(port.PROJECT || port.DEVELOPER || "Community port")}</div>
      <div class="port-bottom"><span>${esc(port.DEVELOPER || "COMMUNITY")}</span><span>VIEW DETAILS ↗</span></div>
    </div>
  </article>`;
}

function openDetails(id) {
  const p = ports.find(item => Number(item.PORTS_ID) === id);
  if (!p) return;
  const cover = safeUrl(p.COVER_URL);
  const links = [[p.URL,"PROJECT"],[p.LINK,"SOURCE"],[p["DATA URL"],"GAME FILES"]].filter(([url]) => safeUrl(url));
  const fields = [["PLATFORM",p.PLATFORM],["VERSION",p.VERSION],["LAST UPDATE",p["LAST UPDATE"]],["DEVELOPER",p.DEVELOPER],["GENRE",p.GENRE],["CONTROLLER",truthy(p["CONTROLLER SUPPORT"]) ? "Supported" : "Not confirmed"],["GAME FILES",truthy(p["NEEDS GAME FILES?"]) ? "Required" : "Not required"],["COMPATIBILITY",truthy(p["WORKS?"]) ? "Working" : "Not confirmed"]];
  $("#dialog-content").innerHTML = `<div class="dialog-cover">${cover ? `<img src="${esc(cover)}" alt="">` : `<span>${esc((p.GAME || "N").slice(0,1))}</span>`}</div><div class="eyebrow">PORT ID / ${String(id).padStart(4,"0")}</div><h2 class="dialog-title">${esc(p.GAME)}</h2><div class="port-project">${esc(p.PROJECT || "")}</div><p class="dialog-description">${esc(p.DESCRIPTION || "No description available.")}</p><div class="detail-grid">${fields.map(([k,v]) => `<div class="detail-item"><small>${esc(k)}</small><b>${esc(v || "—")}</b></div>`).join("")}</div>${p.NOTES ? `<p class="dialog-description"><b>Notes:</b> ${esc(p.NOTES)}</p>` : ""}<div class="dialog-links">${links.map(([url,label]) => `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`).join("")}</div>`;
  $("#port-dialog").showModal();
}

$("#search-input").addEventListener("input", render);
$("#platform-filter").addEventListener("change", render);
$("#genre-filter").addEventListener("change", render);
$("#sort-filter").addEventListener("change", render);
$("#clear-filters").addEventListener("click", () => { $("#search-input").value = ""; $("#platform-filter").value = ""; $("#genre-filter").value = ""; render(); });
$("#dialog-close").addEventListener("click", () => $("#port-dialog").close());
$("#port-dialog").addEventListener("click", event => { if (event.target === $("#port-dialog")) $("#port-dialog").close(); });
document.addEventListener("keydown", event => { if (event.key === "/" && !["INPUT","TEXTAREA"].includes(document.activeElement.tagName)) { event.preventDefault(); $("#search-input").focus(); } });
loadPorts();