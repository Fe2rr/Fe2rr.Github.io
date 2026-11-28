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
    if (button.id !== "logout-button" && button.id !== "close-community" && button.id !== "close-sync") {
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
  for (const game of next.catalog.games) {
    if (!Array.isArray(game.ports)) game.ports = [];
    if (!game.year) game.year = game.ports.find(port => port.year)?.year || "";
    for (const port of game.ports) { delete port.year; delete port.works; }
    delete game.manufacturer;
  }
  next.syncCursor = Number(next.syncCursor) || 0;
  next.syncLog = Array.isArray(next.syncLog) ? next.syncLog : [];
  return next;
}
function renderAll() {
  renderGameList();
  renderEditor();
  $("connection-state").textContent = "GitHub conectado · Fe2rr/NAPL-Data";
}
let openPlatforms = new Set();
let activeSyncFilter = "all";
function gameSyncStatus(game) {
  return (game.ports || []).some((port) => Boolean(port.syncProvider && port.syncTarget && port.githubStatus !== "down"));
}
function renderGameList() {
  const games = state?.catalog?.games || [];
  const q = $("search").value.trim().toLowerCase();
  const mode = activeSyncFilter;
  const platforms = [...new Set([...(state?.catalog?.platformOrder || []), ...games.map(g=>g.platform).filter(Boolean)])];
  const filtered = games.filter(game => {
    const synced = gameSyncStatus(game);
    if (mode === "synced" && !synced) return false;
    if (mode === "unsynced" && synced) return false;
    return [game.name,game.slug,game.platform,...(game.ports||[]).flatMap(p=>[p.project,p.developer,p.portId,p.url,p.githubRepo])].join(" ").toLowerCase().includes(q);
  });
  $("catalog-count").textContent = filtered.length + " / " + games.length + " juegos · " + games.reduce((n,g)=>n+(g.ports||[]).length,0) + " ports";
  const orderedPlatforms = [...platforms, ...[...new Set(filtered.map(g=>g.platform).filter(Boolean))].filter(p=>!platforms.includes(p))];
  const renderPlatform = platform => {
    const entries = filtered.filter(game=>game.platform===platform);
    const isOpen = openPlatforms.has(platform);
    return `<details class="platform-accordion" data-platform-accordion="${esc(platform)}" ${isOpen?"open":""}>
      <summary><span>${esc(platform)}</span><span class="platform-summary-meta">${entries.length} juegos</span></summary>
      <div class="platform-accordion-content">
        <div class="platform-content-heading"><strong>${esc(platform)}</strong><button type="button" class="button secondary category-add" data-add-port-platform="${esc(platform)}">+ Port</button></div>
        ${entries.map(game=>`<button type="button" class="game-item ${game.slug===selectedSlug?"active":""}" data-select-game="${esc(game.slug)}"><strong>${esc(game.name||"Sin nombre")}</strong><small><span class="sync-dot ${gameSyncStatus(game)?"is-synced":""}"></span>${gameSyncStatus(game)?"Sync":"No sync"} · ${(game.ports||[]).length} ports</small></button>`).join("")||'<p class="muted">No hay juegos en esta plataforma.</p>'}
      </div></details>`;
  };
  const segaPlatforms = orderedPlatforms.filter(platform => /sega/i.test(platform));
  const otherPlatforms = orderedPlatforms.filter(platform => !/sega/i.test(platform));
  const segaGroup = segaPlatforms.length ? `<section class="admin-maker-group"><h3>SEGA</h3>${segaPlatforms.map(renderPlatform).join("")}</section>` : "";
  $("game-list").innerHTML = otherPlatforms.map(renderPlatform).join("") + segaGroup || '<p class="muted">No hay resultados.</p>';
}

function detectMetadataSource(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error("El enlace no es una URL válida."); }
  const rawHost = url.hostname.toLowerCase();
  const host = rawHost.startsWith("www.") ? rawHost.slice(4) : rawHost;
  if (host === "store.steampowered.com" || host === "steamcommunity.com") return "steam";
  if (host === "launchbox-app.com" || host.endsWith(".launchbox-app.com")) return "launchbox";
  if (host === "itch.io" || host.endsWith(".itch.io")) return "itch";
  throw new Error("No reconozco el sitio. Usá un enlace de Steam, LaunchBox o itch.io.");
}
function renderEditor() {
  const game = currentGame();
  $("empty-state").hidden = Boolean(game);
  $("game-form").hidden = !game;
  if (!game) return;
  $("editor-title").textContent = game.name || "Nuevo juego";
  const form = $("game-form");
  for (const key of ["name","slug","platform","year","genre","coverUrl","description"]) {
    const field = form.elements.namedItem(key);
    if (field) field.value = game[key] ?? "";
  }
  const metadataUrl = game.steamUrl || game.launchboxUrl || game.itchUrl || "";
  $("metadata-url").value = metadataUrl;
  $("metadata-url").dataset.source = game.steamUrl ? "steam" : game.launchboxUrl ? "launchbox" : game.itchUrl ? "itch" : "";
  const preview = $("game-cover-preview");
  preview.src = game.coverUrl || "";
  preview.hidden = !game.coverUrl;
  $("port-count").textContent = (game.ports || []).length + " ports";
  const platformSelect = form.elements.namedItem("platform");
  const platforms = [...new Set([...(state?.catalog?.platformOrder||[]),...(state?.catalog?.games||[]).map(g=>g.platform).filter(Boolean)])];
  const segaPlatforms = platforms.filter(p => /sega/i.test(p));
  const otherPlatforms = platforms.filter(p => !/sega/i.test(p));
  platformSelect.innerHTML = otherPlatforms.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join("")
    + (segaPlatforms.length ? `<optgroup label="SEGA">${segaPlatforms.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join("")}</optgroup>` : "")
    + '<option value="__add_new__">＋ Agregar nueva plataforma…</option>';
  if (game.platform && !platforms.includes(game.platform)) platformSelect.insertAdjacentHTML("afterbegin",`<option value="${esc(game.platform)}">${esc(game.platform)}</option>`);
  platformSelect.value = game.platform || "";
  $("ports-list").innerHTML = (game.ports || []).map((port, i) => `
    <article class="port-card" data-port-card="${i}">
      <div class="port-head"><strong>Port ${i + 1} · ${esc(port.project || "Sin proyecto")}</strong><div><button type="button" class="button danger" data-remove-port="${i}">Eliminar</button></div></div>
      <div class="port-source-row">${portField(i,"url","Enlace del port",port.url,"url")}<button type="button" class="button secondary" data-inspect-port="${i}">Obtener datos del enlace</button></div>
      <details class="port-data-details"><summary>Datos del port</summary><div class="port-fields">
        ${portField(i,"project","Proyecto",port.project)}
        ${portField(i,"developer","Desarrollador",port.developer)}
        ${portField(i,"version","Versión",port.version)}
        ${portField(i,"controller","Soporte de mando",port.controller)}
        ${portField(i,"files","Archivos del juego",port.files)}
        ${portField(i,"link","Etiqueta del enlace",port.link)}
        ${portField(i,"dataUrl","URL de archivos",port.dataUrl,"url")}
        ${portField(i,"githubRepo","Repositorio GitHub",port.githubRepo)}
        ${portField(i,"portId","ID del port",port.portId)}
        ${portField(i,"lastUpdate","Última actualización",port.lastUpdate)}
        ${portField(i,"dateAdded","Fecha de alta",port.dateAdded)}
        ${portField(i,"notes","Notas",port.notes,"textarea",true)}
      </div></details>
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
  for (const key of ["name","slug","platform","year","genre","coverUrl","description"]) {
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
    delete next.year;
    delete next.works;
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
    $("github-pat").value = "";
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
  if (game && (!game.name || !game.slug)) throw new Error("El juego necesita nombre y slug.");
  const duplicates = game ? state.catalog.games.filter((g) => g.slug === game.slug && g !== game) : [];
  if (duplicates.length) throw new Error("Ya existe otro juego con ese slug.");
  setBusy(true, "Guardando catálogo en GitHub…");
  try {
    const saved = await saveAndPublishCatalogState(state, { publishPublic: true, message: "NAPL Admin: " + game.name });
    state = normalizeState(saved.state);
    selectedSlug = game?.slug || state.catalog.games[0]?.slug || "";
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
function renderSyncSteps(run) {
  const jobs = Array.isArray(run.jobs) ? run.jobs : [];
  const steps = jobs.flatMap((job) => job.steps || []);
  const total = steps.length;
  const completed = steps.filter((step) => step.status === "completed").length;
  const active = steps.find((step) => step.status === "in_progress");
  const failed = steps.find((step) => step.conclusion === "failure");
  const percent = run.status === "completed" ? 100 : total ? Math.min(95, Math.round(((completed + (active ? 0.35 : 0)) / total) * 100)) : 5;
  $("sync-progress-bar").style.width = percent + "%";
  $("sync-progress-percent").textContent = percent + "%";
  $("sync-progress-label").textContent = run.status === "completed" ? "Workflow finalizado" : active?.name || failed?.name || "Ejecutando workflow";
  $("sync-status").textContent = run.status === "completed"
    ? "Workflow " + (run.conclusion || "finalizado") + ". Cargando resultados por port…"
    : "GitHub Actions está procesando la sincronización. El avance corresponde a las etapas reales del workflow.";
  $("sync-live-results").innerHTML = jobs.map((job) => {
    const rows = (job.steps || []).map((step) => {
      const icon = step.conclusion === "success" ? "✓" : step.conclusion === "failure" ? "✕" : step.status === "in_progress" ? "…" : "○";
      return '<div class="sync-result-row"><span>' + esc(step.name) + '</span><strong>' + icon + '</strong></div>';
    }).join("");
    return '<div class="sync-job-group"><strong>' + esc(job.name) + '</strong>' + rows + '</div>';
  }).join("") || '<span>Esperando a que GitHub Actions inicie el job…</span>';
  $("sync-workflow-link").innerHTML = run.htmlUrl ? '<a href="' + esc(run.htmlUrl) + '" target="_blank" rel="noopener">Ver ejecución en GitHub Actions</a>' : "";
}
function renderSyncResults(lastSync) {
  const ports = Array.isArray(lastSync?.ports) ? lastSync.ports : [];
  $("sync-stats").innerHTML = [
    ["Ports", lastSync?.total ?? ports.length],
    ["Revisados", lastSync?.checked ?? 0],
    ["Actualizados", lastSync?.updated ?? 0],
    ["Con error", lastSync?.errors ?? 0],
  ].map(([label,value]) => '<div class="sync-stat"><small>' + esc(label) + '</small><strong>' + Number(value || 0).toLocaleString("es-UY") + '</strong></div>').join("");
  $("sync-results-title").textContent = "Resultado por port · " + ports.length;
  $("sync-live-results").innerHTML = ports.map((port) => {
    const status = port.status === "error" || port.status === "down" ? "Error" :
      port.status === "skipped" ? "Omitido" : port.changed ? "Actualizado" : "Sin cambios";
    const icon = status === "Error" ? "✕" : status === "Actualizado" ? "✓" : status === "Omitido" ? "—" : "·";
    const name = port.project || port.portId || port.gameSlug || "Port sin nombre";
    const detail = [port.gameSlug, port.message].filter(Boolean).join(" · ");
    return '<div class="sync-result-row"><span><strong>' + esc(name) + '</strong>' + (detail ? '<small>' + esc(detail) + '</small>' : '') + '</span><strong>' + icon + ' ' + status + '</strong></div>';
  }).join("") || '<span>No hay resultados individuales disponibles.</span>';
  $("sync-status").textContent = "Sincronización finalizada: " + (lastSync?.updated || 0) + " actualizados, " + (lastSync?.errors || 0) + " con error y " + (lastSync?.skipped || 0) + " omitidos.";
}
async function runSync(importSheets = false) {
  if (busy) return;
  const allPorts = (state?.catalog?.games || []).flatMap((game) => (game.ports || []).map((port) => ({
    name: port.project || port.portId || game.name,
    game: game.name || game.slug,
  })));
  $("sync-dialog").showModal();
  $("sync-status").textContent = importSheets ? "Importando CSV y preparando sincronización…" : "Preparando sincronización…";
  $("sync-progress-bar").style.width = "0%";
  $("sync-progress-percent").textContent = "0%";
  $("sync-progress-label").textContent = "Esperando workflow";
  $("sync-stats").innerHTML = "";
  $("sync-results-title").textContent = "Ports incluidos en esta ejecución · " + allPorts.length;
  $("sync-live-results").innerHTML = allPorts.map((port) =>
    '<div class="sync-result-row"><span><strong>' + esc(port.name) + '</strong><small>' + esc(port.game) + '</small></span><strong>En espera</strong></div>'
  ).join("") || "<span>No hay ports en el catálogo.</span>";
  $("sync-workflow-link").textContent = "";
  setBusy(true, importSheets ? "Importando CSV y sincronizando…" : "Sincronizando fuentes…");
  try {
    const run = await triggerCatalogSync({ importSheets, optimizeCovers: true, timeoutMs: 900000, pollIntervalMs: 5000,
      onProgress: (progress) => {
        $("connection-state").textContent = "Sync: " + progress.status + (progress.conclusion ? " · " + progress.conclusion : "");
        renderSyncSteps(progress);
      } });
    await loadState();
    renderSyncResults(state?.lastSync);
    $("sync-progress-bar").style.width = "100%";
    $("sync-progress-percent").textContent = "100%";
    notice(importSheets ? "Importación y sincronización completadas." : "Sincronización completada.", "success");
    return run;
  } catch (error) {
    $("sync-status").textContent = error.message || "La sincronización falló.";
    $("sync-progress-label").textContent = "Error";
    $("sync-live-results").insertAdjacentHTML("afterbegin", '<div class="sync-result-row"><strong>La ejecución no pudo completarse.</strong><span>✕</span></div>');
    throw error;
  } finally {
    setBusy(false);
  }
}
function table(title, rows, columns) {
  const content = Array.isArray(rows) ? rows : [];
  return `<section class="community-section"><h3>${esc(title)} · ${content.length}</h3><div class="table-wrap"><table><thead><tr>${columns.map(c=>`<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${content.map(row=>`<tr>${columns.map(c=>`<td>${esc(typeof c.value==="function"?c.value(row):row[c.key])}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${columns.length}">Sin registros.</td></tr>`}</tbody></table></div></section>`;
}
async function loadCommunity() {
  $("community-status").textContent = "Consultando resumen comunitario…";
  $("community-data").innerHTML = "";
  $("community-dialog").showModal();
  try {
    const data = await fetchCommunityAdminDashboard({ pat });
    const totals = data.totals || {};
    const metrics = [
      ["Reportes pendientes", totals.linkReports], ["Reportes compatibilidad", totals.compatibilityReports],
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
        {label:"Port ID",key:"port_id"},{label:"Votos",key:"votes"},{label:"Promedio",key:"avg"},{label:"Puntaje",key:"score"}
      ]) +
      table("Popularidad", data.popularity, [
        {label:"Juego",key:"game_key"},{label:"Visitas totales",key:"all_time_visits"},{label:"Semana",key:"week_visits"},{label:"Mes",key:"month_visits"},{label:"Actualizado",key:"updated_at"}
      ]);
    $("community-status").textContent = "Datos obtenidos desde Supabase y snapshots de GitHub.";
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
$("sync-filter").addEventListener("click", (event) => {
  const button = event.target.closest("[data-sync-filter]");
  if (!button) return;
  activeSyncFilter = button.dataset.syncFilter;
  $("sync-filter").querySelectorAll("[data-sync-filter]").forEach(item=>item.classList.toggle("active",item===button));
  renderGameList();
});
$("game-form").elements.namedItem("platform").addEventListener("change", (event) => {
  if (event.target.value !== "__add_new__") return;
  const name = prompt("Nombre de la nueva plataforma:");
  if (!name?.trim()) { event.target.value = currentGame()?.platform || ""; return; }
  const platform = name.trim();
  if (!state.catalog.platformOrder.includes(platform)) state.catalog.platformOrder.push(platform);
  event.target.insertAdjacentHTML("beforeend", `<option value="${esc(platform)}">${esc(platform)}</option>`);
  event.target.value = platform;
  renderGameList();
});
$("game-list").addEventListener("toggle", (event) => {
  const accordion = event.target.closest("[data-platform-accordion]");
  if (!accordion) return;
  const platform = accordion.dataset.platformAccordion;
  if (accordion.open) openPlatforms.add(platform); else openPlatforms.delete(platform);
}, true);
$("game-list").addEventListener("click", (event) => {
  const addPortButton = event.target.closest("[data-add-port-platform]");
  if (addPortButton) {
    if (currentGame()) readDraft();
    const platform = addPortButton.dataset.addPortPlatform;
    const base = {name:"Nuevo juego",slug:"nuevo-juego",platform,year:"",coverUrl:"",genre:"",description:"",ports:[]};
    let slug=base.slug,n=2; while(state.catalog.games.some(g=>g.slug===slug)) slug=base.slug+"-"+n++;
    base.slug=slug;
    base.ports.push({portId:slug+"-port-1",project:"",developer:"",version:"",controller:"",files:"",link:"",url:"",dataUrl:"",githubRepo:"",lastUpdate:"",dateAdded:new Date().toISOString().slice(0,10),notes:""});
    state.catalog.games.unshift(base); selectedSlug=slug; openPlatforms.add(platform); renderAll(); return;
  }
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
  game.ports.push({portId:game.slug+"-port-"+(game.ports.length+1),project:"",developer:"",version:"",controller:"",files:"",link:"",url:"",dataUrl:"",githubRepo:"",lastUpdate:"",dateAdded:new Date().toISOString().slice(0,10),notes:""});
  renderEditor();
});
$("ports-list").addEventListener("click", async (event) => {
  const removeButton = event.target.closest("[data-remove-port]");
  if (removeButton) {
    const game = readDraft();
    game.ports.splice(Number(removeButton.dataset.removePort),1);
    renderEditor();
    return;
  }
  const inspectButton = event.target.closest("[data-inspect-port]");
  if (!inspectButton || busy) return;
  const game = readDraft();
  const port = game.ports[Number(inspectButton.dataset.inspectPort)];
  const target = port?.githubRepo || port?.url || port?.link;
  if (!target) return notice("Este port no tiene una fuente para consultar.", "error");
  setBusy(true, "Revisando fuente del port con GitHub Actions…");
  try {
    const result = await runGithubLookup("port_source", target, { timeoutMs:300000, pollIntervalMs:4000 });
    const info = result?.data || result;
    const fields = {project:info.project || info.name,developer:info.developer,version:info.version,controller:info.controller,files:info.files,link:info.link,url:info.repoUrl || info.url || target,githubRepo:info.githubRepo || info.syncTarget,portId:info.portId,lastUpdate:info.lastUpdate};
    for (const [key,value] of Object.entries(fields)) if (value && !port[key]) port[key] = value;
    renderEditor();
    notice("Fuente consultada. Se completaron los datos disponibles; revisalos antes de guardar.", "success");
  } catch (error) {
    notice(error.message || "No se pudo consultar la fuente.", "error");
  } finally {
    setBusy(false);
  }
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
$("close-sync").addEventListener("click", () => $("sync-dialog").close());
$("lookup-metadata").addEventListener("click", async () => {
  const url = $("metadata-url").value.trim();
  if (!url) return notice("Ingresá la URL del juego.", "error");
  setBusy(true, "Consultando metadatos con GitHub Actions…");
  try {
    const mode = detectMetadataSource(url);
    const data = await runGithubLookup(mode, url, { timeoutMs:300000, pollIntervalMs:4000 });
    const game = readDraft();
    const payload = data?.data || data;
    const aliases = {title:"name",name:"name",year:"year",coverUrl:"coverUrl",cover_url:"coverUrl",genre:"genre",description:"description"};
    for (const [source,target] of Object.entries(aliases)) if (payload?.[source] && !game[target]) game[target] = payload[source];
    game.steamUrl = mode === "steam" ? url : "";
    game.launchboxUrl = mode === "launchbox" ? url : "";
    game.itchUrl = mode === "itch" ? url : "";
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
