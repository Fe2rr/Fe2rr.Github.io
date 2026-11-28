import {
  clearEncryptedGithubVault,
  clearGithubSession,
  dispatchWorkflow,
  exportEncryptedGithubVault,
  fetchCommunityAdminDashboard,
  getStoredGithubPat,
  hasEncryptedGithubVault,
  hasLegacyPlaintextPat,
  importEncryptedGithubVault,
  lockGithubSession,
  loginWithGithubPat,
  readAdminCatalogState,
  runGithubLookup,
  saveAndPublishCatalogState,
  setupGithubPasswordVault,
  triggerCatalogSync,
  triggerCommunitySummarySync,
  unlockGithubVaultWithPassword,
  updateCommunityLinkReportStatus,
  waitForDispatchedWorkflow,
} from "../js/lib/github-admin.js";

const $ = (id) => document.getElementById(id);
const loginView = $("login-view");
const adminView = $("admin-view");
let pat = getStoredGithubPat();
let state = null;
let selectedSlug = "";
let busy = false;
let loginMode = hasEncryptedGithubVault() ? "unlock" : "setup";
let useLegacyMigrationPat = !hasEncryptedGithubVault() && hasLegacyPlaintextPat();

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
function syncLoginModeUi() {
  const vaultExists = hasEncryptedGithubVault();
  if (loginMode === "unlock" && !vaultExists) {
    loginMode = "setup";
  }
  const isUnlock = loginMode === "unlock";
  $("unlock-fields").hidden = !isUnlock;
  $("setup-fields").hidden = isUnlock;
  $("admin-password").disabled = !isUnlock;
  $("admin-password").required = isUnlock;
  $("setup-password").disabled = isUnlock;
  $("setup-password").required = !isUnlock;
  $("setup-password-confirm").disabled = isUnlock;
  $("setup-password-confirm").required = !isUnlock;
  $("github-pat").disabled = isUnlock || useLegacyMigrationPat;
  $("github-pat").required = !isUnlock && !useLegacyMigrationPat;
  $("pat-field-wrap").hidden = isUnlock || useLegacyMigrationPat;
  $("legacy-pat-banner").hidden = isUnlock || !useLegacyMigrationPat;
  $("switch-to-setup").hidden = !isUnlock;
  $("switch-to-unlock").hidden = isUnlock || !vaultExists;
  $("forget-vault").hidden = !vaultExists;
  $("export-vault-btn").hidden = !vaultExists;

  if (isUnlock) {
    $("login-title").textContent = "Desbloquear panel";
    $("login-subtitle").textContent = "Ingresá tu contraseña para descifrar tu acceso a GitHub en este navegador.";
    $("login-submit").textContent = "Entrar";
  } else if (useLegacyMigrationPat) {
    $("login-title").textContent = "Proteger acceso con contraseña";
    $("login-subtitle").textContent = "Definí una contraseña para cifrar el token guardado y entrar solo con contraseña a partir de ahora.";
    $("login-submit").textContent = "Guardar contraseña y entrar";
  } else {
    $("login-title").textContent = "Configurar acceso con contraseña";
    $("login-subtitle").textContent = "Tu GitHub PAT se cifra localmente con AES-256 usando tu contraseña y nunca se guarda sin cifrar.";
    $("login-submit").textContent = "Guardar contraseña y entrar";
  }
}

function showAdmin() {
  loginView.hidden = true;
  adminView.hidden = false;
  renderAll();
}
function showLogin(message = "") {
  adminView.hidden = true;
  loginView.hidden = false;
  syncLoginModeUi();
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
const ADMIN_PLATFORM_GROUP_ORDER = ["Nintendo", "Sega", "Sony", "Xbox", "Others"];

function getAdminPlatformGroup(platform) {
  const normalized = String(platform || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (normalized === "others" || normalized === "other") return "Others";
  if (
    normalized.includes("playstation") ||
    normalized.includes("sony") ||
    /\bps[1-5p]\b/.test(normalized) ||
    normalized.includes("vita")
  ) {
    return "Sony";
  }
  if (normalized.includes("sega")) return "Sega";
  if (normalized.startsWith("xbox")) return "Xbox";
  if (
    normalized.includes("nintendo") ||
    normalized.includes("game boy") ||
    normalized.includes("gameboy") ||
    normalized.includes("gamecube") ||
    normalized === "nes"
  ) {
    return "Nintendo";
  }
  return "Others";
}

function renderGameList() {
  const games = state?.catalog?.games || [];
  const q = $("search").value.trim().toLowerCase();
  const mode = activeSyncFilter;
  const isFiltering = Boolean(q) || mode !== "all";
  const platforms = [...new Set([...(state?.catalog?.platformOrder || []), ...games.map(g=>g.platform).filter(Boolean)])];
  const filtered = games.filter(game => {
    const synced = gameSyncStatus(game);
    if (mode === "synced" && !synced) return false;
    if (mode === "unsynced" && synced) return false;
    return [game.name,game.slug,game.platform,...(game.ports||[]).flatMap(p=>[p.project,p.developer,p.portId,p.url,p.githubRepo])].join(" ").toLowerCase().includes(q);
  });
  $("catalog-count").textContent = filtered.length + " / " + games.length + " juegos · " + games.reduce((n,g)=>n+(g.ports||[]).length,0) + " ports";
  const orderedPlatforms = [...platforms, ...[...new Set(filtered.map(g=>g.platform).filter(Boolean))].filter(p=>!platforms.includes(p))]
    .filter(platform => !isFiltering || filtered.some(game => game.platform === platform));
  const renderPlatform = platform => {
    const entries = filtered
      .filter(game => game.platform === platform)
      .sort((a, b) => Number(gameSyncStatus(a)) - Number(gameSyncStatus(b)));
    const isOpen = openPlatforms.has(platform);
    return `<div class="platform-accordion-wrap">
      <details class="platform-accordion" data-platform-accordion="${esc(platform)}" ${isOpen?"open":""}>
        <summary><span class="platform-accordion-title">${esc(platform)}</span><span class="platform-summary-meta">${entries.length} juegos</span></summary>
        <div class="platform-accordion-content">
          ${entries.map(game=>`<button type="button" class="game-item ${game.slug===selectedSlug?"active":""}" data-select-game="${esc(game.slug)}"><strong>${esc(game.name||"Sin nombre")}</strong><small><span class="sync-dot ${gameSyncStatus(game)?"is-synced":""}"></span>${gameSyncStatus(game)?"Sync":"No sync"} · ${(game.ports||[]).length} ports</small></button>`).join("")||'<p class="muted">No hay juegos en esta plataforma.</p>'}
        </div>
      </details>
      <button type="button" class="platform-add-btn category-add-outside" data-add-port-platform="${esc(platform)}" title="Agregar juego en ${esc(platform)}">+ Juego</button>
    </div>`;
  };
  const grouped = new Map(ADMIN_PLATFORM_GROUP_ORDER.map(group => [group, []]));
  for (const platform of orderedPlatforms) {
    const group = getAdminPlatformGroup(platform);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(platform);
  }
  const sectionsHtml = [...grouped.entries()]
    .filter(([, groupPlatforms]) => groupPlatforms.length > 0)
    .map(([group, groupPlatforms]) => `<section class="admin-maker-group"><h3>${esc(group)}</h3>${groupPlatforms.map(renderPlatform).join("")}</section>`)
    .join("");
  $("game-list").innerHTML = sectionsHtml || '<p class="muted">No hay resultados.</p>';
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
function getPortRepoStatusMeta(port) {
  const rawStatus = String(port?.githubStatus || "").trim().toLowerCase();
  if (rawStatus === "down") {
    return { cls: "down", label: "Caído" };
  }
  if (rawStatus === "moved") {
    return { cls: "moved", label: "Movido" };
  }
  if (rawStatus === "ok" || (port?.syncProvider && port?.syncTarget)) {
    return { cls: "ok", label: "Activo" };
  }
  return { cls: "", label: "Sin verificar" };
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
  const groupedPlatforms = new Map(ADMIN_PLATFORM_GROUP_ORDER.map(group => [group, []]));
  for (const p of platforms) {
    const group = getAdminPlatformGroup(p);
    if (!groupedPlatforms.has(group)) groupedPlatforms.set(group, []);
    groupedPlatforms.get(group).push(p);
  }
  platformSelect.innerHTML = [...groupedPlatforms.entries()]
    .filter(([, list]) => list.length > 0)
    .map(([group, list]) => `<optgroup label="${esc(group)}">${list.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join("")}</optgroup>`)
    .join("")
    + '<option value="__add_new__">＋ Agregar nueva plataforma…</option>';
  if (game.platform && !platforms.includes(game.platform)) platformSelect.insertAdjacentHTML("afterbegin",`<option value="${esc(game.platform)}">${esc(game.platform)}</option>`);
  platformSelect.value = game.platform || "";
  $("ports-list").innerHTML = (game.ports || []).map((port, i) => {
    const repoStatus = getPortRepoStatusMeta(port);
    return `
    <article class="port-card" data-port-card="${i}">
      <div class="port-head">
        <strong>Port ${i + 1} · ${esc(port.project || "Sin proyecto")}</strong>
        <span class="gh-badge ${repoStatus.cls}" title="Estado del repositorio">${esc(repoStatus.label)}</span>
      </div>
      <div class="port-source-row">${portField(i,"url","Enlace del port",port.url,"url")}<button type="button" class="button secondary" data-inspect-port="${i}">Obtener datos del enlace</button></div>
      <div class="port-fields">
        ${portField(i,"project","Proyecto",port.project)}
        ${portField(i,"link","Etiqueta de URL",port.link)}
        ${portField(i,"developer","Desarrollador",port.developer)}
        ${portField(i,"version","Versión",port.version)}
        ${portField(i,"lastUpdate","Última actualización",port.lastUpdate)}
        ${portField(i,"files","Archivos de juego",port.files)}
        ${portField(i,"dataUrl","URL de archivos",port.dataUrl,"url")}
        ${portField(i,"controller","Soporte de mando",port.controller)}
        ${portField(i,"notes","Notas",port.notes,"textarea",true)}
      </div>
      <details class="port-data-details"><summary>ID y fecha de alta</summary><div class="port-fields">
        ${portField(i,"portId","ID",port.portId)}
        ${portField(i,"dateAdded","Fecha de alta",port.dateAdded)}
      </div></details>
      <div class="port-card-footer">
        <button type="button" class="button small danger-button" data-remove-port="${i}">Eliminar port</button>
      </div>
    </article>`;
  }).join("") || '<p class="muted">Esta ficha todavía no tiene ports.</p>';
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
async function handleLoginSubmit() {
  if (busy) return;
  $("login-message").textContent = "";
  if (loginMode === "unlock") {
    const password = $("admin-password").value;
    if (!password) {
      $("login-message").textContent = "Ingresá tu contraseña.";
      $("admin-password").focus();
      return;
    }
    setBusy(true, "Descifrando y verificando acceso en GitHub…");
    $("login-submit").textContent = "Verificando acceso…";
    let unlockedResult = null;
    try {
      unlockedResult = await unlockGithubVaultWithPassword(password);
      pat = getStoredGithubPat();
    } catch (error) {
      lockGithubSession();
      pat = "";
      setBusy(false);
      showLogin(error.message || "No se pudo desbloquear el acceso.");
      return;
    }

    try {
      $("login-submit").textContent = "Cargando catálogo…";
      await loadState();
      $("admin-password").value = "";
      showAdmin();
      notice("Conectado como " + (unlockedResult.user?.login || "administrador") + ".", "success");
    } catch (error) {
      lockGithubSession();
      pat = "";
      showLogin("Acceso verificado, pero falló la carga del catálogo: " + (error.message || "error desconocido"));
    } finally {
      setBusy(false);
    }
    return;
  }

  const rawPat = $("github-pat").value.trim();
  const password = $("setup-password").value;
  const confirmPassword = $("setup-password-confirm").value;
  if (!useLegacyMigrationPat && !rawPat) {
    $("login-message").textContent = "Ingresá tu GitHub Fine-grained PAT.";
    $("github-pat").focus();
    return;
  }
  if (password.length < 8) {
    $("login-message").textContent = "La contraseña debe tener al menos 8 caracteres.";
    $("setup-password").focus();
    return;
  }
  if (password !== confirmPassword) {
    $("login-message").textContent = "Las contraseñas no coinciden.";
    $("setup-password-confirm").focus();
    return;
  }

  setBusy(true, "Validando permisos en GitHub y cifrando acceso…");
  $("login-submit").textContent = "Cifrando y verificando…";
  let setupResult = null;
  try {
    setupResult = await setupGithubPasswordVault({
      pat: rawPat,
      password,
      useLegacyPat: useLegacyMigrationPat,
    });
    pat = getStoredGithubPat();
    useLegacyMigrationPat = false;
    loginMode = "unlock";
  } catch (error) {
    lockGithubSession();
    pat = "";
    setBusy(false);
    showLogin(error.message || "No se pudo configurar la contraseña.");
    return;
  }

  try {
    $("login-submit").textContent = "Cargando catálogo…";
    await loadState();
    $("github-pat").value = "";
    $("setup-password").value = "";
    $("setup-password-confirm").value = "";
    showAdmin();
    notice("Contraseña configurada. Conectado como " + (setupResult.user?.login || "administrador") + ".", "success");
  } catch (error) {
    lockGithubSession();
    pat = "";
    loginMode = hasEncryptedGithubVault() ? "unlock" : "setup";
    showLogin("Contraseña guardada, pero falló la carga del catálogo: " + (error.message || "error desconocido"));
  } finally {
    setBusy(false);
  }
}
let activeDeployGeneration = 0;

async function monitorBackgroundPagesDeploy(workflowFile, dispatchedAt, generation) {
  const isStale = () => generation !== activeDeployGeneration || !getStoredGithubPat();
  try {
    const run = await waitForDispatchedWorkflow(workflowFile, dispatchedAt, {
      timeoutMs: 300000,
      pollIntervalMs: 2500,
      shouldStop: isStale,
      onProgress: (progress) => {
        if (isStale()) return;
        const label = progress.status === "completed" ? "Publicación Pages finalizada" : "Publicando en Pages…";
        $("connection-state").textContent = label;
      },
    });
    if (!run || isStale()) return;
    $("connection-state").textContent = "GitHub conectado · Fe2rr/NAPL-Data";
    $("save-hint").textContent = "Cambios publicados en GitHub Pages.";
    notice("Cambios publicados en GitHub Pages.", "success");
  } catch (error) {
    if (isStale()) return;
    $("connection-state").textContent = "GitHub conectado · Fe2rr/NAPL-Data";
    $("save-hint").textContent = "Guardado en GitHub, pero falló la publicación en Pages.";
    notice(error?.message || "Guardado en GitHub, pero falló la publicación en GitHub Pages.", "error");
  }
}

async function saveCatalog() {
  if (busy) return;
  const game = readDraft();
  if (game && (!game.name || !game.slug)) throw new Error("El juego necesita nombre y slug.");
  const duplicates = game ? state.catalog.games.filter((g) => g.slug === game.slug && g !== game) : [];
  if (duplicates.length) throw new Error("Ya existe otro juego con ese slug.");
  setBusy(true, "Guardando catálogo en GitHub…");
  let deployRun = null;
  try {
    const saved = await saveAndPublishCatalogState(state, {
      publishPublic: true,
      message: "NAPL Admin: " + (game?.name || "update catalog"),
    });
    state = normalizeState(saved.state);
    selectedSlug = game?.slug || state.catalog.games[0]?.slug || "";
    deployRun = await dispatchWorkflow("deploy-pages.yml", {});
    renderAll();
    $("save-hint").textContent = "Guardado en GitHub · Publicando en Pages en segundo plano…";
    notice("Guardado en GitHub. Publicación en GitHub Pages iniciada…", "success");
  } finally {
    setBusy(false);
  }
  if (deployRun) {
    const generation = ++activeDeployGeneration;
    $("connection-state").textContent = "Publicando en Pages…";
    void monitorBackgroundPagesDeploy(deployRun.workflowFile, deployRun.dispatchedAt, generation);
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
    const run = await triggerCatalogSync({ importSheets, optimizeCovers: true, timeoutMs: 900000, pollIntervalMs: 2500,
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
let communityState = null;
let communityRefreshing = false;

function formatCommunityTimestamp(iso) {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString("es-UY");
}

function table(title, rows, columns) {
  const content = Array.isArray(rows) ? rows : [];
  return `<section class="community-section"><h3>${esc(title)} · ${content.length}</h3><div class="table-wrap"><table><thead><tr>${columns.map(c=>`<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${content.map(row=>`<tr>${columns.map(c=>`<td>${typeof c.html === "function" ? c.html(row) : esc(typeof c.value==="function"?c.value(row):row[c.key])}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${columns.length}">Sin registros.</td></tr>`}</tbody></table></div></section>`;
}

function renderCommunityDashboard(data) {
  communityState = data;
  const totals = data?.totals || {};
  const metrics = [
    ["Reportes pendientes", totals.linkReports],
    ["Reportes resueltos", totals.resolvedLinkReports],
    ["Reportes compatibilidad", totals.compatibilityReports],
    ["Votos", totals.ratingVotes],
    ["Juegos con visitas", totals.gamesTracked],
    ["Visitas totales", totals.allTimeVisits],
  ];
  $("community-data").innerHTML = '<div class="community-grid">' + metrics.map(([label,value])=>`<div class="metric"><small>${esc(label)}</small><strong>${Number(value || 0).toLocaleString("es-UY")}</strong></div>`).join("") + "</div>" +
    table("Reportes de enlaces", data.reports, [
      {label:"Fecha",value:r=>formatCommunityTimestamp(r.updated_at || r.created_at)},
      {label:"Port ID",key:"port_id"},
      {label:"Motivo",key:"reason"},
      {label:"Nota",key:"note"},
      {label:"URL",key:"url"},
      {label:"Discord",value:r=>r.discord_notified_at?"Enviado":"Pendiente"},
      {label:"Estado",html:r=>`<span class="report-status-badge ${r.status==="resolved"?"is-resolved":"is-pending"}">${r.status==="resolved"?"Resuelto":"Pendiente"}</span>`},
      {label:"Acción",html:r=>{
        const next = r.status === "resolved" ? "pending" : "resolved";
        const label = r.status === "resolved" ? "Reabrir" : "Resolver";
        return `<button type="button" class="button secondary report-status-btn" data-toggle-report="${esc(r.reportKey)}" data-next-status="${esc(next)}">${label}</button>`;
      }},
    ]) +
    table("Reportes de compatibilidad", data.compatibility, [
      {label:"Fecha",value:r=>formatCommunityTimestamp(r.updated_at)},{label:"Port ID",key:"port_id"},{label:"Dispositivo",key:"device_name"},{label:"Estado",key:"status"},{label:"Funciona",value:r=>r.works?"Sí":"No"}
    ]) +
    table("Ratings", data.ratings, [
      {label:"Port ID",key:"port_id"},{label:"Votos",key:"votes"},{label:"Promedio",key:"avg"},{label:"Puntaje",key:"score"}
    ]) +
    table("Popularidad", data.popularity, [
      {label:"Juego",key:"game_key"},{label:"Visitas totales",key:"all_time_visits"},{label:"Semana",key:"week_visits"},{label:"Mes",key:"month_visits"},{label:"Actualizado",value:r=>formatCommunityTimestamp(r.updated_at)}
    ]);

  if (!data.hasSummaryFile && !data.hasReportsFile) {
    $("community-status").textContent = "Todavía no hay archivos comunitarios en Fe2rr/NAPL-Data. Usá «Actualizar desde GitHub Actions» para generarlos.";
    return;
  }
  const parts = ["Datos leídos desde JSON en GitHub (Fe2rr/NAPL-Data)"];
  if (data.generatedAt) parts.push("Snapshot: " + formatCommunityTimestamp(data.generatedAt));
  if (!data.hasReportsFile) parts.push("Sin historial de reportes aún");
  $("community-status").textContent = parts.join(" · ");
}

async function loadCommunity() {
  $("community-status").textContent = "Consultando archivos JSON en GitHub…";
  $("community-data").innerHTML = "";
  if (!$("community-dialog").open) {
    $("community-dialog").showModal();
  }
  try {
    const data = await fetchCommunityAdminDashboard({ pat });
    renderCommunityDashboard(data);
  } catch (error) {
    $("community-status").textContent = error.message || "No se pudo cargar el dashboard desde GitHub.";
  }
}

async function refreshCommunityFromActions() {
  if (communityRefreshing) return;
  communityRefreshing = true;
  const button = $("refresh-community");
  button.disabled = true;
  $("community-status").textContent = "Iniciando actualización en GitHub Actions…";
  try {
    await triggerCommunitySummarySync({
      pat,
      timeoutMs: 300000,
      pollIntervalMs: 2000,
      onProgress: (run) => {
        $("community-status").textContent = "GitHub Actions (" + (run.status || "running") + (run.conclusion ? " · " + run.conclusion : "") + ")…";
      },
    });
    await loadCommunity();
    notice("Datos comunitarios actualizados desde GitHub Actions.", "success");
  } catch (error) {
    $("community-status").textContent = error.message || "No se pudo ejecutar la actualización en GitHub Actions.";
  } finally {
    communityRefreshing = false;
    button.disabled = false;
  }
}

$("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  handleLoginSubmit();
});
$("switch-to-setup").addEventListener("click", () => {
  loginMode = "setup";
  useLegacyMigrationPat = false;
  $("login-message").textContent = "";
  syncLoginModeUi();
});
$("switch-to-unlock").addEventListener("click", () => {
  loginMode = "unlock";
  useLegacyMigrationPat = false;
  $("login-message").textContent = "";
  syncLoginModeUi();
});
$("use-new-pat-btn").addEventListener("click", () => {
  useLegacyMigrationPat = false;
  $("login-message").textContent = "";
  syncLoginModeUi();
});
$("toggle-vault-transfer").addEventListener("click", () => {
  const panel = $("vault-transfer-panel");
  panel.hidden = !panel.hidden;
});
$("export-vault-btn").addEventListener("click", async () => {
  try {
    const serialized = exportEncryptedGithubVault();
    $("vault-transfer-input").value = serialized;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(serialized);
      $("login-message").textContent = "Bóveda cifrada copiada al portapapeles.";
    } else {
      $("vault-transfer-input").select();
      $("login-message").textContent = "Bóveda cifrada lista para copiar abajo.";
    }
  } catch (error) {
    $("login-message").textContent = error.message || "No se pudo exportar la bóveda.";
  }
});
$("import-vault-btn").addEventListener("click", () => {
  try {
    importEncryptedGithubVault($("vault-transfer-input").value);
    useLegacyMigrationPat = false;
    loginMode = "unlock";
    $("vault-transfer-panel").hidden = true;
    $("vault-transfer-input").value = "";
    syncLoginModeUi();
    $("login-message").textContent = "Bóveda importada. Ingresá tu contraseña para entrar.";
  } catch (error) {
    $("login-message").textContent = error.message || "No se pudo importar la bóveda.";
  }
});
$("forget-vault").addEventListener("click", () => {
  if (!confirm("¿Eliminar el acceso guardado en este navegador?")) return;
  clearEncryptedGithubVault();
  pat = "";
  useLegacyMigrationPat = false;
  loginMode = "setup";
  $("admin-password").value = "";
  $("login-message").textContent = "Acceso eliminado de este navegador.";
  syncLoginModeUi();
});
$("logout-button").addEventListener("click", () => {
  lockGithubSession();
  pat = "";
  state = null;
  loginMode = hasEncryptedGithubVault() ? "unlock" : "setup";
  $("admin-password").value = "";
  showLogin("Sesión bloqueada.");
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
  setBusy(true, "Consultando fuente del port…");
  try {
    const result = await runGithubLookup("port_source", target, { timeoutMs:180000, pollIntervalMs:1000 });
    const info = result?.data || result;
    const fields = {project:info.project || info.name,developer:info.developer,version:info.version,controller:info.controller,files:info.files,link:info.link,url:info.repoUrl || info.url || target,githubRepo:info.githubRepo || info.syncTarget,portId:info.portId,lastUpdate:info.lastUpdate};
    for (const [key,value] of Object.entries(fields)) if (value && !port[key]) port[key] = value;
    if (info?.status) port.githubStatus = info.status;
    if (info?.syncProvider) port.syncProvider = info.syncProvider;
    if (info?.syncTarget) port.syncTarget = info.syncTarget;
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
$("refresh-community").addEventListener("click", refreshCommunityFromActions);
$("close-community").addEventListener("click", () => $("community-dialog").close());
$("close-sync").addEventListener("click", () => $("sync-dialog").close());
$("community-data").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-toggle-report]");
  if (!button || button.disabled) return;
  const reportKey = button.dataset.toggleReport;
  const nextStatus = button.dataset.nextStatus;
  button.disabled = true;
  button.textContent = "Guardando…";
  $("community-status").textContent = "Guardando estado del reporte en GitHub…";
  try {
    const result = await updateCommunityLinkReportStatus(reportKey, nextStatus, { pat });
    if (communityState) {
      const updatedReports = (result.reports || []).map((item) => ({
        ...item,
        reportKey: item.id !== null && item.id !== undefined && String(item.id).trim() !== ""
          ? `id:${String(item.id).trim()}`
          : `key:${item.port_id}|${item.created_at || item.updated_at}|${item.url}`,
      }));
      const pendingCount = updatedReports.filter((item) => item.status !== "resolved").length;
      renderCommunityDashboard({
        ...communityState,
        reportsUpdatedAt: result.updatedAt,
        hasReportsFile: true,
        totals: {
          ...communityState.totals,
          linkReports: pendingCount,
          resolvedLinkReports: updatedReports.length - pendingCount,
          totalLinkReports: updatedReports.length,
        },
        reports: updatedReports,
      });
    } else {
      await loadCommunity();
    }
  } catch (error) {
    $("community-status").textContent = error.message || "No se pudo actualizar el estado del reporte.";
    button.disabled = false;
    button.textContent = nextStatus === "resolved" ? "Resolver" : "Reabrir";
  }
});
$("lookup-metadata").addEventListener("click", async () => {
  const url = $("metadata-url").value.trim();
  if (!url) return notice("Ingresá la URL del juego.", "error");
  setBusy(true, "Consultando metadatos…");
  try {
    const mode = detectMetadataSource(url);
    const data = await runGithubLookup(mode, url, { timeoutMs:180000, pollIntervalMs:1000 });
    const game = readDraft();
    const payload = data?.data || data;
    const isPlaceholderName = !game.name || /^nuevo juego$/i.test(game.name.trim());
    const wasPlaceholderSlug = !game.slug || /^nuevo-juego(?:-\d+)?$/i.test(game.slug.trim());
    const aliases = {title:"name",name:"name",year:"year",coverUrl:"coverUrl",cover_url:"coverUrl",genre:"genre",description:"description"};
    for (const [source,target] of Object.entries(aliases)) {
      if (!payload?.[source]) continue;
      if (target === "name") {
        if (isPlaceholderName) game.name = payload[source];
      } else if (!game[target]) {
        game[target] = payload[source];
      }
    }
    if (game.name && !/^nuevo juego$/i.test(game.name.trim()) && wasPlaceholderSlug) {
      const baseSlug = makeSlug(game.name) || "juego";
      let nextSlug = baseSlug;
      let n = 2;
      while (state.catalog.games.some((g) => g !== game && g.slug === nextSlug)) {
        nextSlug = `${baseSlug}-${n++}`;
      }
      game.slug = nextSlug;
      selectedSlug = nextSlug;
    }
    game.steamUrl = mode === "steam" ? url : "";
    game.launchboxUrl = mode === "launchbox" ? url : "";
    game.itchUrl = mode === "itch" ? url : "";
    renderAll();
    notice("Consulta completada. Revisá los campos y guardá los cambios.", "success");
  } catch (error) { notice(error.message || "No se pudieron obtener los metadatos.", "error"); }
  finally { setBusy(false); }
});
$("optimize-cover")?.addEventListener("click", async () => {
  const game = readDraft();
  const url = game.coverUrl || $("metadata-url").value.trim();
  if (!url) return notice("El juego no tiene una URL de portada.", "error");
  setBusy(true, "Optimizando portada con GitHub Actions…");
  try {
    const result = await runGithubLookup("optimize_cover", url, { timeoutMs:300000, pollIntervalMs:1500 });
    notice("Portada optimizada: " + (result.staticCoverPath || "manifest actualizado") + ". Guardá el catálogo para publicar.", "success");
  } catch (error) { notice(error.message || "No se pudo optimizar la portada.", "error"); }
  finally { setBusy(false); }
});

async function boot() {
  if (!pat) {
    loginMode = hasEncryptedGithubVault() ? "unlock" : "setup";
    useLegacyMigrationPat = !hasEncryptedGithubVault() && hasLegacyPlaintextPat();
    return showLogin();
  }
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
