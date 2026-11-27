import {
  clearGithubSession,
  fetchCommunityAdminDashboard,
  getStoredGithubPat,
  loginWithGithubPat,
  readAdminCatalogState,
  runGithubLookup,
  saveAndPublishCatalogState,
  triggerCatalogSync,
  dispatchWorkflowAndWait,
} from "../js/lib/github-admin.js";

const $ = (id) => document.getElementById(id);
const loginView = $("login-view");
const adminView = $("admin-view");
let pat = getStoredGithubPat();
let state = null;
let selectedSlug = "";
let busy = false;

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

function notice(message, type = "") {
  const el = $("notice");
  el.textContent = message || "";
  el.className = "notice " + type;
  el.hidden = !message;
}
function setBusy(value, message = "") {
  busy = value;
  document.querySelectorAll("button").forEach((button) => {
    if (button.id !== "logout-button" && button.id !== "close-community") {
      button.disabled = value;
    }
  });
  $("connection-state").textContent = message || (value ? "Procesando…" : "Conectado a GitHub");
}
function currentGame() {
  return state?.catalog?.games?.find((game) => game.slug === selectedSlug) || null;
}
function makeSlug(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function showAdmin() {
  loginView.hidden = true;
  adminView.hidden = false;
  renderAll();
}
function showLogin(message = "") {
  adminView.hidden = true;
  loginView.hidden = false;
  $("login-message").textContent = message;
}
function normalizeState(value) {
  const next = value && typeof value === "object" ? value : {};
  next.version = Number(next.version) || 1;
  next.catalog = next.catalog && typeof next.catalog === "object" ? next.catalog : {};
  next.catalog.version = Number(next.catalog.version) || 1;
  next.catalog.updatedAt = next.catalog.updatedAt || "";
  next.catalog.platformOrder = Array.isArray(next.catalog.platformOrder) ? next.catalog.platformOrder : [];
  next.catalog.games = Array.isArray(next.catalog.games) ? next.catalog.games : [];
  next.syncCursor = Number(next.syncCursor) || 0;
  next.syncLog = Array.isArray(next.syncLog) ? next.syncLog : [];
  return next;
}
function renderAll() {
  renderGameList();
  renderEditor();
  $("connection-state").textContent = "GitHub conectado · Fe2rr/NAPL-Data";
}
function renderGameList() {
  const games = state?.catalog?.games || [];
  const q = $("search").value.trim().toLowerCase();
  const filtered = games.filter((game) => {
    const haystack = [game.name, game.slug, game.platform, ...(game.ports || []).flatMap((p) => [p.project, p.developer, p.portId, p.url, p.githubRepo])].join(" ").toLowerCase();
    return haystack.includes(q);
  });
  $("catalog-count").textContent = games.length + " juegos · " + games.reduce((n, g) => n + (g.ports || []).length, 0) + " ports";
  $("game-list").innerHTML = filtered.map((game) => `
    <button type="button" class="game-item ${game.slug === selectedSlug ? "active" : ""}" data-select-game="${esc(game.slug)}">
      <strong>${esc(game.name || "Sin nombre")}</strong>
      <small>${esc(game.platform || "Sin plataforma")} · ${(game.ports || []).length} ports</small>
    </button>`).join("") || '<p class="muted">No hay resultados.</p>';
  const platforms = [...new Set([...(state?.catalog?.platformOrder || []), ...games.map((g) => g.platform).filter(Boolean)])];
  $("platform-options").innerHTML = platforms.map((p) => `<option value="${esc(p)}"></option>`).join("");
}
function renderEditor() {
  const game = currentGame();
  $("empty-state").hidden = Boolean(game);
  $("game-form").hidden = !game;
  if (!game) return;
  $("editor-title").textContent = game.name || "Nuevo juego";
  const form = $("game-form");
  for (const key of ["name","slug","platform","year","genre","coverUrl","steamUrl","launchboxUrl","description"]) {
    const field = form.elements.namedItem(key);
    if (field) field.value = game[key] ?? "";
  }
  $("metadata-url").value = game.steamUrl || game.launchboxUrl || "";
  $("port-count").textContent = (game.ports || []).length + " ports";
  $("ports-list").innerHTML = (game.ports || []).map((port, i) => `
    <article class="port-card" data-port-card="${i}">
      <div class="port-head"><strong>Port ${i + 1} · ${esc(port.project || "Sin proyecto")}</strong><button type="button" class="button danger" data-remove-port="${i}">Eliminar</button></div>
      <div class="port-fields">
        ${portField(i,"project","Proyecto",port.project)}
        ${portField(i,"developer","Desarrollador",port.developer)}
        ${portField(i,"year","Año",port.year)}
        ${portField(i,"version","Versión",port.version)}
        ${portField(i,"controller","Soporte de mando",port.controller)}
        ${portField(i,"files","Archivos del juego",port.files)}
        ${portField(i,"works","Estado / funciona",port.works)}
        ${portField(i,"link","Etiqueta del enlace",port.link)}
        ${portField(i,"url","URL del port",port.url,"url")}
        ${portField(i,"dataUrl","URL de archivos",port.dataUrl,"url")}
        ${portField(i,"githubRepo","Repositorio GitHub",port.githubRepo)}
        ${portField(i,"portId","ID del port",port.portId)}
        ${portField(i,"lastUpdate","Última actualización",port.lastUpdate)}
        ${portField(i,"dateAdded","Fecha de alta",port.dateAdded)}
        ${portField(i,"notes","Notas",port.notes,"textarea",true)}
      </div>
    </article>`).join("") || '<p class="muted">Esta ficha todavía no tiene ports.</p>';
}
function portField(i, key, label, value, type = "text", wide = false) {
  const control = type === "textarea"
    ? `<textarea data-port-index="${i}" data-port-field="${key}" rows="2">${esc(value)}</textarea>`
    : `<input type="${type}" data-port-index="${i}" data-port-field="${key}" value="${esc(value)}">`;
  return `<label class="${wide ? "wide" : ""}">${label}${control}</label>`;
}
function readDraft() {
  const game = currentGame();
  if (!game) return null;
  const form = $("game-form");
  for (const key of ["name","slug","platform","year","genre","coverUrl","steamUrl","launchboxUrl","description"]) {
    game[key] = String(form.elements.namedItem(key)?.value || "").trim();
  }
  if (!game.slug) game.slug = makeSlug(game.name);
  game.ports = [...$("ports-list").querySelectorAll("[data-port-card]")].map((card) => {
    const index = Number(card.dataset.portCard);
    const existing = game.ports[index] || {};
    const next = { ...existing };
    card.querySelectorAll("[data-port-field]").forEach((field) => {
      next[field.dataset.portField] = field.value.trim();
    });
    if (!next.portId) next.portId = game.slug + "-port-" + (index + 1);
    return next;
  });
  game.platforms = game.platform ? [game.platform] : [];
  return game;
}
async function loadState() {
  const result = await readAdminCatalogState();
  state = normalizeState(result.state);
  selectedSlug = state.catalog.games[0]?.slug || "";
  renderAll();
}
async function login(raw) {
  setBusy(true, "Verificando permisos de GitHub…");
  try {
    const result = await loginWithGithubPat(raw);
    pat = raw.trim();
    await loadState();
    showAdmin();
    notice("Conectado como " + (result.user?.login || "administrador") + ".", "success");
  } catch (error) {
    clearGithubSession();
    pat = "";
    showLogin(error.message || "No se pudo validar el PAT.");
  } finally {
    setBusy(false);
  }
}
async function saveCatalog() {
  if (busy) return;
  const game = readDraft();
  if (!game.name || !game.slug) throw new Error("El juego necesita nombre y slug.");
  const duplicates = state.catalog.games.filter((g) => g.slug === game.slug && g !== game);
  if (duplicates.length) throw new Error("Ya existe otro juego con ese slug.");
  setBusy(true, "Guardando catálogo en GitHub…");
  try {
    const saved = await saveAndPublishCatalogState(state, { publishPublic: true, message: "NAPL Admin: " + game.name });
    state = normalizeState(saved.state);
    selectedSlug = game.slug;
    $("save-hint").textContent = "JSON privado y snapshot público guardados.";
    notice("Guardado en Fe2rr/NAPL-Data. Publicando GitHub Pages…");
    await dispatchWorkflowAndWait("deploy-pages.yml", {}, {
      timeoutMs: 300000,
      onProgress: (run) => { $("connection-state").textContent = "Publicación Pages: " + run.status; },
    });
    renderAll();
    notice("Cambios guardados y publicados en GitHub Pages.", "success");
  } finally {
    setBusy(false);
  }
}
async function runSync(importSheets = false) {
  if (busy) return;
  setBusy(true, importSheets ? "Importando CSV y sincronizando…" : "Sincronizando fuentes…");
  try {
    await triggerCatalogSync({ importSheets, optimizeCovers: true, timeoutMs: 900000, pollIntervalMs: 5000,
      onProgress: (run) => { $("connection-state").textContent = "Sync: " + run.status + (run.conclusion ? " · " + run.conclusion : ""); } });
    await loadState();
    notice(importSheets ? "Importación y sincronización completadas." : "Sincronización completada.", "success");
  } finally {
    setBusy(false);
  }
}
function table(title, rows, columns) {
  const content = Array.isArray(rows) ? rows : [];
  return `<section class="community-section"><h3>${esc(title)} · ${content.length}</h3><div class="table-wrap"><table><thead><tr>${columns.map(c=>`<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${content.map(row=>`<tr>${columns.map(c=>`<td>${esc(typeof c.value==="function"?c.value(row):row[c.key])}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${columns.length}">Sin registros.</td></tr>`}</tbody></table></div></section>`;
}
async function loadCommunity() {
  $("community-status").textContent = "Consultando Cloudflare D1…";
  $("community-data").innerHTML = "";
  $("community-dialog").showModal();
  try {
    const data = await fetchCommunityAdminDashboard({ pat });
    const totals = data.totals || {};
    const metrics = [
      ["Reportes de enlaces", totals.linkReports], ["Reportes compatibilidad", totals.compatibilityReports],
      ["Votos", totals.ratingVotes], ["Juegos con visitas", totals.gamesTracked], ["Visitas totales", totals.allTimeVisits],
    ];
    $("community-data").innerHTML = '<div class="community-grid">' + metrics.map(([label,value])=>`<div class="metric"><small>${esc(label)}</small><strong>${Number(value || 0).toLocaleString("es-UY")}</strong></div>`).join("") + "</div>" +
      table("Reportes de enlaces", data.reports, [
        {label:"Fecha",key:"updated_at"},{label:"Port ID",key:"port_id"},{label:"Motivo",key:"reason"},{label:"Nota",key:"note"},{label:"URL",key:"url"},{label:"Discord",value:r=>r.discord_notified_at?"Enviado":"Pendiente"}
      ]) +
      table("Reportes de compatibilidad", data.compatibility, [
        {label:"Fecha",key:"updated_at"},{label:"Port ID",key:"port_id"},{label:"Dispositivo",key:"device_name"},{label:"Estado",key:"status"},{label:"Funciona",value:r=>r.works?"Sí":"No"}
      ]) +
      table("Ratings", data.ratings, [
        {label:"Port ID",key:"port_id"},{label:"Votos",key:"votes"},{label:"Suma estrellas",key:"sum_stars"},{label:"Actualizado",key:"updated_at"}
      ]) +
      table("Popularidad", data.popularity, [
        {label:"Juego",key:"game_key"},{label:"Visitas totales",key:"all_time_visits"},{label:"Semana",key:"week_visits"},{label:"Mes",key:"month_visits"},{label:"Actualizado",key:"updated_at"}
      ]);
    $("community-status").textContent = "Datos obtenidos desde napl-community-api.";
  } catch (error) {
    $("community-status").textContent = error.message || "No se pudo cargar el dashboard.";
  }
}

$("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  login($("github-pat").value);
});
$("logout-button").addEventListener("click", () => {
  clearGithubSession(); pat = ""; state = null; showLogin();
});
$("search").addEventListener("input", renderGameList);
$("game-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-game]");
  if (!button) return;
  if (currentGame()) readDraft();
  selectedSlug = button.dataset.selectGame;
  renderAll();
});
$("new-game").addEventListener("click", () => {
  const base = { name:"Nuevo juego", slug:"nuevo-juego", platform:"", year:"", coverUrl:"", genre:"", description:"", ports:[] };
  let slug = base.slug, n = 2;
  while (state.catalog.games.some(g=>g.slug===slug)) slug = base.slug + "-" + n++;
  base.slug = slug;
  state.catalog.games.unshift(base);
  selectedSlug = slug;
  renderAll();
});
$("delete-game").addEventListener("click", async () => {
  const game = currentGame();
  if (!game || !confirm("¿Eliminar " + game.name + " del catálogo?")) return;
  state.catalog.games = state.catalog.games.filter(g=>g.slug!==selectedSlug);
  selectedSlug = state.catalog.games[0]?.slug || "";
  renderAll();
  try { await saveCatalog(); } catch (error) { notice(error.message, "error"); }
});
$("add-port").addEventListener("click", () => {
  const game = readDraft();
  game.ports.push({portId:game.slug+"-port-"+(game.ports.length+1),project:"",developer:"",year:"",version:"",controller:"",files:"",works:"",link:"",url:"",dataUrl:"",githubRepo:"",lastUpdate:"",dateAdded:new Date().toISOString().slice(0,10),notes:""});
  renderEditor();
});
$("ports-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-port]");
  if (!button) return;
  const game = readDraft();
  game.ports.splice(Number(button.dataset.removePort),1);
  renderEditor();
});
$("game-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await saveCatalog(); } catch (error) { notice(error.message || "Error guardando.", "error"); }
});
$("sync-button").addEventListener("click", async () => {
  try { await runSync(false); } catch (error) { notice(error.message || "Falló la sincronización.", "error"); }
});
$("import-button").addEventListener("click", async () => {
  if (!confirm("Importar el CSV puede modificar juegos y ports. ¿Continuar?")) return;
  try { await runSync(true); } catch (error) { notice(error.message || "Falló la importación.", "error"); }
});
$("community-button").addEventListener("click", loadCommunity);
$("close-community").addEventListener("click", () => $("community-dialog").close());
$("lookup-metadata").addEventListener("click", async () => {
  const url = $("metadata-url").value.trim();
  if (!url) return notice("Ingresá una URL de Steam o LaunchBox.", "error");
  const mode = /store\.steampowered\.com\/app\/|^\d+$/.test(url) ? "steam" : "launchbox";
  setBusy(true, "Consultando metadatos con GitHub Actions…");
  try {
    const data = await runGithubLookup(mode, url, { timeoutMs:300000, pollIntervalMs:4000 });
    const game = readDraft();
    const aliases = {title:"name",name:"name",year:"year",coverUrl:"coverUrl",cover_url:"coverUrl",genre:"genre",description:"description",steamUrl:"steamUrl",steam_url:"steamUrl",launchboxUrl:"launchboxUrl"};
    for (const [source,target] of Object.entries(aliases)) if (data?.[source] && !game[target]) game[target] = data[source];
    renderEditor();
    notice("Consulta completada. Revisá los campos y guardá los cambios.", "success");
  } catch (error) { notice(error.message || "No se pudieron obtener los metadatos.", "error"); }
  finally { setBusy(false); }
});
$("optimize-cover").addEventListener("click", async () => {
  const game = readDraft();
  const url = game.coverUrl || $("metadata-url").value.trim();
  if (!url) return notice("El juego no tiene una URL de portada.", "error");
  setBusy(true, "Optimizando portada con GitHub Actions…");
  try {
    const result = await runGithubLookup("optimize_cover", url, { timeoutMs:300000, pollIntervalMs:4000 });
    notice("Portada optimizada: " + (result.staticCoverPath || "manifest actualizado") + ". Guardá el catálogo para publicar.", "success");
  } catch (error) { notice(error.message || "No se pudo optimizar la portada.", "error"); }
  finally { setBusy(false); }
});

async function boot() {
  if (!pat) return showLogin();
  try {
    await loginWithGithubPat(pat);
    await loadState();
    showAdmin();
  } catch (error) {
    clearGithubSession();
    pat = "";
    showLogin("La sesión anterior ya no es válida. " + (error.message || ""));
  }
}
boot();
