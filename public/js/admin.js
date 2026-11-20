import { resolveCatalogApiBase } from "./lib/config.js";

const API = resolveCatalogApiBase();
const $ = (id) => document.getElementById(id);

const fieldLabels = {
  portId: "ID único",
  project: "Proyecto",
  platform: "Plataforma",
  developer: "Desarrollador",
  year: "Año",
  version: "Versión",
  controller: "Soporte de mando",
  files: "¿Necesita archivos del juego?",
  works: "Estado / ¿Funciona?",
  link: "Etiqueta de enlace",
  url: "Enlace del port / descarga",
  dataUrl: "Enlace de archivos del juego",
  githubRepo: "Repositorio GitHub",
  lastUpdate: "Última actualización",
  dateAdded: "Fecha de alta",
  notes: "Notas",
};

let token = sessionStorage.getItem("napl_admin_session") || "";
let catalog = { version: 1, updatedAt: "", platformOrder: [], games: [] };
let stats = {
  gamesCount: 0,
  portsCount: 0,
  githubCount: 0,
  downCount: 0,
  lastSyncAt: "",
  lastGitHubPublishAt: "",
  pendingGitHubSync: false,
};
let syncLogs = [];
let selectedSlug = "";
let sidebarFilter = "all";
let unsavedGame = false;
let savingInFlight = false;
let saveTimer = null;

// Ephemeral per-editor UI states (cleared on switch)
let launchboxStatus = { state: "", text: "", diff: null, undo: null };
const portUiState = new Map();
const persistedSlugs = new WeakMap();

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function gameBySlug(slug) {
  return catalog.games.find((g) => g.slug === slug);
}

function safeUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function looksLikeGithubUrl(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) return true;
  return /github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i.test(text);
}

function looksLikeLaunchboxUrl(value) {
  return /gamesdb\.launchbox-app\.com\//i.test(String(value || "").trim());
}

function formatShortDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function setNotice(message, type = "") {
  const box = $("notice");
  box.hidden = !message;
  box.className = "notice " + type;
  box.textContent = "";
  if (!message) return;
  if (typeof message === "string") box.textContent = message;
  else box.append(message);
}

function updateTopState() {
  const dot = $("state-dot");
  const label = $("save-state");
  const publishBtn = $("publish-button");

  dot.classList.remove("pending", "saving");
  if (savingInFlight) {
    dot.classList.add("saving");
    label.textContent = "Guardando en D1…";
  } else if (unsavedGame) {
    dot.classList.add("pending");
    label.textContent = "Cambios locales sin guardar…";
  } else if (stats.pendingGitHubSync) {
    dot.classList.add("pending");
    label.textContent = "Guardado en D1 · Pendiente backup GitHub";
  } else {
    label.textContent = "Sincronizado (D1 + GitHub)";
  }

  publishBtn.disabled = savingInFlight || (!stats.pendingGitHubSync && !unsavedGame);
  $("catalog-count").textContent = `${catalog.games.length} juegos · ${catalog.games.reduce(
    (n, g) => n + g.ports.length,
    0
  )} ports · ${stats.githubCount || 0} GH`;
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch(API + path, { ...options, headers });
  const data = await response.json().catch(() => ({ error: "Respuesta inválida del servidor." }));
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/login") {
      token = "";
      sessionStorage.removeItem("napl_admin_session");
      showLogin();
    }
    throw new Error(data.error || "Error HTTP " + response.status);
  }
  return data;
}

function showLogin() {
  $("login-view").hidden = false;
  $("admin-view").hidden = true;
}

function showAdmin() {
  $("login-message").textContent = "";
  $("login-view").hidden = true;
  $("admin-view").hidden = false;
}

function hydrateServerState(data, keepSelected = true) {
  if (data.catalog) {
    catalog = data.catalog;
    for (const g of catalog.games) {
      persistedSlugs.set(g, g.slug);
    }
  }
  if (data.stats) stats = data.stats;
  if (Array.isArray(data.syncLogs)) syncLogs = data.syncLogs;

  if (!keepSelected || !gameBySlug(selectedSlug)) {
    selectedSlug = catalog.games[0]?.slug || "";
  }
  updateTopState();
}

async function loadCatalog() {
  const result = await api("/api/catalog");
  hydrateServerState(result, false);
  unsavedGame = false;
  updateTopState();
  renderSidebar();
  renderEditor();
  if (!result.exists) {
    setNotice("La base de datos está vacía. Importá el CSV o creá el primer juego.", "");
  } else {
    setNotice("");
  }
}

function portHasGithub(port) {
  return Boolean(
    port.githubRepo ||
      /github\.com|github\.io|raw\.githubusercontent\.com/i.test(
        [port.link, port.url, port.dataUrl].join(" ")
      )
  );
}

function portHasAlert(port) {
  return port.githubStatus === "down" || port.githubStatus === "moved" || port.link === "Repo Down";
}

function gameButton(game, platform) {
  const platformPorts = game.ports.filter((p) => !platform || p.platform === platform);
  const hasAlert = platformPorts.some(portHasAlert);
  return (
    '<button type="button" class="game-item ' +
    (game.slug === selectedSlug ? "active" : "") +
    '" data-game="' +
    esc(game.slug) +
    '">' +
    '<span class="game-item-main">' +
    esc(game.name) +
    "<small>" +
    game.ports.length +
    " ports</small></span>" +
    (hasAlert ? '<span class="game-item-alert">ALERTA</span>' : "") +
    "</button>"
  );
}

function renderSidebar() {
  const query = $("game-search").value.trim().toLowerCase();
  const platforms = [...catalog.platformOrder];
  for (const game of catalog.games) {
    for (const port of game.ports) {
      if (port.platform && !platforms.includes(port.platform)) {
        platforms.push(port.platform);
      }
    }
  }

  const root = $("platform-list");
  root.innerHTML = "";

  // Also show games with 0 ports (e.g. newly created games) under "Sin plataforma asignada"
  const unplacedGames = catalog.games.filter((g) => {
    if (g.ports.some((p) => p.platform)) return false;
    if (query && !(g.name + " " + g.slug).toLowerCase().includes(query)) return false;
    if (sidebarFilter === "github" || sidebarFilter === "alerts") return false;
    return true;
  });

  if (unplacedGames.length) {
    const details = document.createElement("details");
    details.className = "platform-group";
    details.open = true;
    details.innerHTML =
      "<summary><span>Sin plataforma asignada</span><span class='platform-count'>" +
      unplacedGames.length +
      "</span></summary><div class='platform-section'>" +
      unplacedGames.map((g) => gameButton(g, "")).join("") +
      "</div>";
    root.append(details);
  }

  for (const platform of platforms) {
    const games = catalog.games.filter((g) => {
      const pList = g.ports.filter((p) => p.platform === platform);
      if (!pList.length) return false;
      if (sidebarFilter === "github" && !pList.some(portHasGithub)) return false;
      if (sidebarFilter === "no-github" && pList.some(portHasGithub)) return false;
      if (sidebarFilter === "alerts" && !pList.some(portHasAlert)) return false;
      if (query) {
        const hay = (
          g.name +
          " " +
          pList.map((p) => `${p.project} ${p.githubRepo} ${p.developer}`).join(" ")
        ).toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
    if (!games.length) continue;

    const noGithub = games.filter((g) => !g.ports.some((p) => p.platform === platform && portHasGithub(p)));
    const github = games.filter((g) => g.ports.some((p) => p.platform === platform && portHasGithub(p)));
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    noGithub.sort(byName);
    github.sort(byName);

    const activeGame = gameBySlug(selectedSlug);
    const details = document.createElement("details");
    details.className = "platform-group";
    details.open =
      Boolean(query) ||
      sidebarFilter === "alerts" ||
      Boolean(activeGame && activeGame.ports.some((p) => p.platform === platform));

    details.innerHTML =
      "<summary><span>" +
      esc(platform) +
      "</span><span class='platform-count'>" +
      noGithub.length +
      "/" +
      games.length +
      "</span></summary><div class='platform-section'>" +
      (noGithub.length
        ? "<div class='section-label'>Sin enlaces GitHub · " +
          noGithub.length +
          "</div>" +
          noGithub.map((g) => gameButton(g, platform)).join("")
        : "") +
      (github.length
        ? "<div class='section-label'>En GitHub · " +
          github.length +
          "</div>" +
          github.map((g) => gameButton(g, platform)).join("")
        : "") +
      "</div>";
    root.append(details);
  }

  root.querySelectorAll("[data-game]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (unsavedGame) {
        await saveCurrentGame({ silent: true });
      }
      selectedSlug = button.dataset.game;
      launchboxStatus = { state: "", text: "", diff: null, undo: null };
      portUiState.clear();
      renderSidebar();
      renderEditor();
    });
  });
}

function fieldHtml(label, value, attr, type = "text", extraClass = "", placeholder = "") {
  const ph = placeholder ? ' placeholder="' + esc(placeholder) + '"' : "";
  return (
    '<div class="field ' +
    extraClass +
    '"><label>' +
    esc(label) +
    "</label>" +
    (type === "textarea"
      ? "<textarea " + attr + ph + ">" + esc(value) + "</textarea>"
      : '<input type="' + type + '" ' + attr + ph + ' value="' + esc(value) + '">') +
    "</div>"
  );
}

function githubBadgeHtml(port) {
  if (port.githubStatus === "down" || port.link === "Repo Down") {
    return '<span class="gh-badge down">REPO CAÍDO</span>';
  }
  if (port.githubStatus === "moved") {
    return '<span class="gh-badge moved">MOVIDO</span>';
  }
  if (port.githubRepo) {
    return '<span class="gh-badge ok">GH ACTIVO</span>';
  }
  return '<span class="gh-badge">SIN SEGUIMIENTO</span>';
}

function portHtml(port, index) {
  const ui = portUiState.get(index) || {};
  const linkButtons = [
    ["Proyecto", safeUrl(port.link) ? port.link : port.githubRepo ? "https://github.com/" + port.githubRepo : ""],
    ["Descarga / Port", port.url],
    ["Archivos", port.dataUrl],
  ]
    .filter((x) => safeUrl(x[1]))
    .map((x) => '<a href="' + esc(x[1]) + '" target="_blank" rel="noopener">' + esc(x[0]) + " ↗</a>")
    .join("");

  const mainFields = ["platform", "developer", "version", "controller", "files", "works", "lastUpdate"];
  const fieldByKey = (key) =>
    fieldHtml(
      fieldLabels[key],
      port[key],
      'data-port-index="' + index + '" data-port-field="' + key + '"',
      key === "notes" ? "textarea" : "text",
      key === "notes" ? "full-width" : ""
    );

  const statusLine = ui.text
    ? '<div class="autofill-status ' +
      esc(ui.state || "") +
      '"><span>' +
      esc(ui.text) +
      "</span>" +
      (ui.undo
        ? '<button type="button" class="inline-link-btn" data-undo-port-fill="' + index + '">Deshacer</button>'
        : "") +
      "</div>"
    : "";

  const diffBanner = ui.diff
    ? '<div class="autofill-diff-banner"><span>GitHub trae nuevos datos (' +
      esc(ui.diff.summary) +
      ')</span><div class="autofill-diff-actions"><button type="button" class="inline-link-btn accent" data-apply-port-diff="' +
      index +
      '">Actualizar campos</button><button type="button" class="inline-link-btn" data-dismiss-port-diff="' +
      index +
      '">Conservar actuales</button></div></div>'
    : "";

  return (
    '<article class="admin-port-card" data-port-card="' +
    index +
    '">' +
    '<div class="admin-port-top">' +
    '<div class="admin-port-meta-row"><span class="admin-port-number">PORT ' +
    String(index + 1).padStart(2, "0") +
    "</span>" +
    githubBadgeHtml(port) +
    "</div>" +
    '<div class="admin-port-heading"><h3 class="admin-port-title">' +
    esc(port.project || "Untitled port") +
    "</h3><span>" +
    esc(port.platform || "Sin plataforma") +
    "</span></div>" +
    fieldHtml(
      "Nombre del proyecto",
      port.project,
      'data-port-index="' + index + '" data-port-field="project"'
    ) +
    "</div>" +
    '<div class="admin-port-body">' +
    '<div class="autofill-box">' +
    '<div class="autofill-row">' +
    fieldHtml(
      "Repositorio GitHub (pegar URL para autocompletar)",
      port.githubRepo || "",
      'data-port-index="' + index + '" data-port-field="githubRepo"',
      "text",
      "",
      "https://github.com/usuario/repositorio o usuario/repo"
    ) +
    '<button type="button" class="button secondary small" data-lookup-port="' +
    index +
    '">Leer GH</button>' +
    (port.portId && port.githubRepo
      ? '<button type="button" class="button secondary small" data-sync-port="' + index + '">Sync</button>'
      : "") +
    "</div>" +
    statusLine +
    diffBanner +
    "</div>" +
    '<div class="admin-port-details">' +
    mainFields.map(fieldByKey).join("") +
    fieldByKey("link") +
    "</div>" +
    '<div class="admin-port-links">' +
    fieldHtml(
      "Enlace del port / descarga (también autocompleta si pegás GitHub)",
      port.url,
      'data-port-index="' + index + '" data-port-field="url"',
      "url",
      "",
      "https://github.com/... o enlace directo .apk"
    ) +
    fieldHtml(
      "Enlace de archivos del juego",
      port.dataUrl,
      'data-port-index="' + index + '" data-port-field="dataUrl"',
      "url"
    ) +
    "</div>" +
    '<div class="admin-port-link-preview">' +
    (linkButtons || '<span class="admin-no-links">Todavía no hay enlaces disponibles</span>') +
    "</div>" +
    '<div class="admin-port-notes">' +
    fieldByKey("notes") +
    "</div>" +
    '<details class="admin-port-advanced"><summary>Datos adicionales e identificación' +
    (port.lastCheckedAt ? " · Revisado " + esc(formatShortDate(port.lastCheckedAt)) : "") +
    '</summary><div class="admin-port-details">' +
    fieldByKey("portId") +
    fieldByKey("year") +
    fieldByKey("dateAdded") +
    "</div></details>" +
    '<div class="admin-port-actions"><span class="admin-port-id">' +
    esc(port.portId || "Sin ID") +
    '</span><button type="button" class="button danger-button small" data-delete-port="' +
    index +
    '">Eliminar port</button></div>' +
    "</div></article>"
  );
}

function renderEditor() {
  const game = gameBySlug(selectedSlug);
  $("empty-editor").hidden = Boolean(game);
  $("game-editor").hidden = !game;
  if (!game) return;

  const root = $("game-editor");
  const lbStatusHtml = launchboxStatus.text
    ? '<div class="autofill-status ' +
      esc(launchboxStatus.state || "") +
      '"><span>' +
      esc(launchboxStatus.text) +
      "</span>" +
      (launchboxStatus.undo
        ? '<button type="button" class="inline-link-btn" id="undo-launchbox">Deshacer</button>'
        : "") +
      "</div>"
    : "";

  const lbDiffHtml = launchboxStatus.diff
    ? '<div class="autofill-diff-banner"><span>LaunchBox tiene valores distintos en: ' +
      esc(launchboxStatus.diff.fields.join(", ")) +
      '</span><div class="autofill-diff-actions"><button type="button" class="inline-link-btn accent" id="apply-launchbox-diff">Aplicar todos</button><button type="button" class="inline-link-btn" id="dismiss-launchbox-diff">Conservar actuales</button></div></div>'
    : "";

  root.innerHTML =
    '<div class="editor-heading"><div><span class="editor-eyebrow">NAPL / D1 / EDICIÓN DIRECTA</span><h1>' +
    esc(game.name || "Nuevo juego") +
    "</h1><p>" +
    esc(game.slug) +
    " · " +
    game.ports.length +
    ' ports</p></div><div class="editor-heading-actions"><button class="button primary" id="save-game-db" type="button">Guardar en D1</button><button class="button danger-button" id="delete-game" type="button">Eliminar juego</button></div></div>' +
    '<section class="admin-game-hero"><div class="admin-cover-column"><div class="admin-cover-frame"><img class="cover-preview" id="cover-preview" src="' +
    esc(game.coverUrl || "") +
    '" alt="Portada de ' +
    esc(game.name) +
    '" onerror="this.hidden=true" onload="this.hidden=false"><span class="cover-placeholder">GAME COVER</span></div>' +
    fieldHtml("URL de portada", game.coverUrl, 'data-game-field="coverUrl"', "url") +
    '</div><div class="admin-game-content"><div class="admin-game-kicker">FICHA DEL JUEGO</div>' +
    '<div class="autofill-box"><div class="autofill-row">' +
    fieldHtml(
      "LaunchBox GamesDB (pegar URL para autocompletar)",
      game.launchboxUrl || "",
      'data-game-field="launchboxUrl"',
      "url",
      "",
      "https://gamesdb.launchbox-app.com/games/details/..."
    ) +
    '<button type="button" class="button secondary small" id="fetch-launchbox-btn">Leer ficha</button></div>' +
    lbStatusHtml +
    lbDiffHtml +
    "</div>" +
    fieldHtml("Nombre del juego", game.name, 'data-game-field="name"', "text", "admin-game-title-input") +
    '<div class="admin-game-meta-grid">' +
    fieldHtml("Año", game.year, 'data-game-field="year"') +
    fieldHtml("Género", game.genre, 'data-game-field="genre"') +
    fieldHtml("Slug / URL", game.slug, 'data-game-field="slug"') +
    "</div>" +
    fieldHtml("Descripción", game.description, 'data-game-field="description"', "textarea", "full-width") +
    "</div></section>" +
    '<section class="admin-ports-section"><div class="admin-ports-heading"><div><span class="editor-eyebrow">BUILDS NATIVAS</span><h2>Available Ports</h2><p>' +
    game.ports.length +
    ' ports asociados a este juego</p></div><button id="add-port" class="button primary" type="button">+ Agregar port</button></div><div id="ports-list" class="admin-port-grid">' +
    game.ports.map((port, index) => portHtml(port, index)).join("") +
    "</div></section>";

  bindEditorEvents(root, game);
}

function syncPlatforms(game) {
  game.platforms = [...new Set(game.ports.map((p) => p.platform).filter(Boolean))];
}

function markUnsavedAndSchedule() {
  unsavedGame = true;
  updateTopState();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveCurrentGame({ silent: true });
  }, 750);
}

async function saveCurrentGame({ silent = false } = {}) {
  clearTimeout(saveTimer);
  const game = gameBySlug(selectedSlug);
  if (!game) return;

  const targetSlug = persistedSlugs.get(game);
  savingInFlight = true;
  updateTopState();

  try {
    let data;
    if (targetSlug) {
      data = await api("/api/games/" + encodeURIComponent(targetSlug), {
        method: "PUT",
        body: JSON.stringify({ game }),
      });
    } else {
      data = await api("/api/games", {
        method: "POST",
        body: JSON.stringify({ game }),
      });
    }
    selectedSlug = data.saved?.slug || game.slug;
    hydrateServerState(data, true);
    unsavedGame = false;
    updateTopState();
    renderSidebar();
    if (!silent) {
      setNotice("Juego guardado directamente en Cloudflare D1 / DB.", "success");
    }
  } catch (error) {
    setNotice("No se pudo guardar en DB: " + error.message, "error");
  } finally {
    savingInFlight = false;
    updateTopState();
  }
}

async function runLaunchboxAutofill(game, urlValue) {
  const url = String(urlValue || "").trim();
  if (!looksLikeLaunchboxUrl(url)) {
    launchboxStatus = {
      state: "error",
      text: "Pegá una URL válida de gamesdb.launchbox-app.com.",
      diff: null,
      undo: null,
    };
    renderEditor();
    return;
  }

  launchboxStatus = { state: "loading", text: "Consultando ficha de LaunchBox…", diff: null, undo: null };
  renderEditor();

  try {
    const res = await api("/api/lookup/launchbox", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
    const lb = res.launchbox;
    const snapshot = {
      name: game.name,
      slug: game.slug,
      year: game.year,
      genre: game.genre,
      description: game.description,
      coverUrl: game.coverUrl,
      launchboxUrl: game.launchboxUrl,
    };

    game.launchboxUrl = lb.launchboxUrl || url;
    const isFreshPlaceholder = /^nuevo juego/i.test(String(game.name || "").trim());
    const diffValues = {};
    const diffFields = [];

    const tryFill = (key, label, nextVal, forceEmptyCheck = false) => {
      const val = String(nextVal || "").trim();
      if (!val) return;
      const cur = String(game[key] || "").trim();
      if (!cur || cur === "-" || forceEmptyCheck) {
        game[key] = val;
      } else if (cur !== val) {
        diffValues[key] = val;
        diffFields.push(label);
      }
    };

    tryFill("name", "Nombre", lb.name, isFreshPlaceholder);
    if (isFreshPlaceholder && lb.name) {
      const nextSlug = slugify(lb.name);
      if (nextSlug && !gameBySlug(nextSlug)) {
        game.slug = nextSlug;
        selectedSlug = nextSlug;
      }
    }
    tryFill("year", "Año", lb.year);
    tryFill("genre", "Género", lb.genre);
    tryFill("description", "Descripción", lb.description);
    tryFill("coverUrl", "Portada", lb.coverUrl);

    launchboxStatus = {
      state: "ok",
      text: "LaunchBox cargado: " + lb.name + (lb.year ? " (" + lb.year + ")" : ""),
      diff: diffFields.length ? { fields: diffFields, values: diffValues } : null,
      undo: snapshot,
    };
    renderEditor();
    renderSidebar();
    await saveCurrentGame({ silent: true });
  } catch (error) {
    launchboxStatus = { state: "error", text: error.message, diff: null, undo: null };
    renderEditor();
  }
}

async function runGithubAutofill(game, index, rawUrl) {
  const port = game.ports[index];
  if (!port || !looksLikeGithubUrl(rawUrl)) {
    portUiState.set(index, {
      state: "error",
      text: "Ingresá una URL de github.com/usuario/repo válida.",
    });
    renderEditor();
    return;
  }

  portUiState.set(index, { state: "loading", text: "Consultando GitHub…" });
  renderEditor();

  try {
    const res = await api("/api/lookup/github", {
      method: "POST",
      body: JSON.stringify({ url: rawUrl }),
    });
    const gh = res.github;
    const snapshot = { ...port };

    if (gh.status === "down") {
      port.githubRepo = gh.githubRepo;
      port.githubStatus = "down";
      port.link = "Repo Down";
      portUiState.set(index, {
        state: "error",
        text: "El repositorio devolvió 404 (Repo Down).",
        undo: snapshot,
      });
      renderEditor();
      await saveCurrentGame({ silent: true });
      return;
    }

    port.githubRepo = gh.githubRepo;
    port.githubStatus = gh.status;
    port.lastCheckedAt = gh.checkedAt || new Date().toISOString();
    if (!port.link || port.link === "Repo Down" || /github/i.test(port.link)) {
      port.link = gh.link;
    }

    // If URL was empty or was the exact repo URL just pasted, upgrade to best download/release link
    const curUrlNorm = String(port.url || "").trim().replace(/\/+$/, "");
    const rawNorm = String(rawUrl || "").trim().replace(/\/+$/, "");
    if (!curUrlNorm || curUrlNorm === rawNorm || curUrlNorm === gh.repoUrl) {
      port.url = gh.recommendedUrl;
    }

    const diffValues = {};
    const diffLabels = [];
    const fillOrDiff = (key, label, nextVal) => {
      const val = String(nextVal || "").trim();
      if (!val) return;
      const cur = String(port[key] || "").trim();
      if (!cur || cur === "-") {
        port[key] = val;
      } else if (cur !== val) {
        diffValues[key] = val;
        diffLabels.push(label);
      }
    };

    fillOrDiff("project", "Proyecto", gh.project);
    fillOrDiff("developer", "Desarrollador", gh.developer);
    fillOrDiff("version", "Versión", gh.version);
    fillOrDiff("lastUpdate", "Última actualización", gh.lastUpdate);

    portUiState.set(index, {
      state: "ok",
      text:
        "GitHub listo: " +
        gh.githubRepo +
        (gh.version ? " · " + gh.version : "") +
        (gh.apkUrl ? " (APK detectado)" : ""),
      diff: diffLabels.length
        ? { summary: diffLabels.join(", "), values: diffValues }
        : null,
      undo: snapshot,
    });
    renderEditor();
    renderSidebar();
    await saveCurrentGame({ silent: true });
  } catch (error) {
    portUiState.set(index, { state: "error", text: error.message });
    renderEditor();
  }
}

function bindEditorEvents(root, game) {
  $("save-game-db")?.addEventListener("click", () => saveCurrentGame({ silent: false }));

  $("delete-game")?.addEventListener("click", async () => {
    if (!confirm('¿Eliminar "' + game.name + '" y todos sus ports de la base de datos?')) return;
    const targetSlug = persistedSlugs.get(game);
    try {
      if (targetSlug) {
        const data = await api("/api/games/" + encodeURIComponent(targetSlug), { method: "DELETE" });
        hydrateServerState(data, false);
      } else {
        catalog.games = catalog.games.filter((g) => g !== game);
        selectedSlug = catalog.games[0]?.slug || "";
      }
      unsavedGame = false;
      updateTopState();
      renderSidebar();
      renderEditor();
      setNotice("Juego eliminado de la base de datos.", "success");
    } catch (error) {
      setNotice("Error eliminando juego: " + error.message, "error");
    }
  });

  // LaunchBox controls
  const lbInput = root.querySelector('[data-game-field="launchboxUrl"]');
  lbInput?.addEventListener("paste", (e) => {
    const pasted = e.clipboardData?.getData("text") || "";
    setTimeout(() => {
      const value = pasted.trim() || lbInput.value.trim();
      game.launchboxUrl = value;
      if (looksLikeLaunchboxUrl(value)) {
        runLaunchboxAutofill(game, value);
      }
    }, 0);
  });

  $("fetch-launchbox-btn")?.addEventListener("click", () => {
    runLaunchboxAutofill(game, lbInput?.value || game.launchboxUrl);
  });

  $("apply-launchbox-diff")?.addEventListener("click", async () => {
    if (!launchboxStatus.diff) return;
    Object.assign(game, launchboxStatus.diff.values);
    launchboxStatus.diff = null;
    renderEditor();
    renderSidebar();
    await saveCurrentGame({ silent: true });
  });

  $("dismiss-launchbox-diff")?.addEventListener("click", () => {
    launchboxStatus.diff = null;
    renderEditor();
  });

  $("undo-launchbox")?.addEventListener("click", async () => {
    if (!launchboxStatus.undo) return;
    Object.assign(game, launchboxStatus.undo);
    selectedSlug = game.slug;
    launchboxStatus = { state: "", text: "Autocompletado de LaunchBox revertido.", diff: null, undo: null };
    renderEditor();
    renderSidebar();
    await saveCurrentGame({ silent: true });
  });

  root.querySelectorAll("[data-game-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.gameField;
      const old = game[key];
      game[key] = input.value;
      if (key === "name" && (!game.slug || game.slug === slugify(old))) {
        const candidate = slugify(input.value);
        if (candidate) {
          game.slug = candidate;
          const slugInput = root.querySelector('[data-game-field="slug"]');
          if (slugInput) slugInput.value = game.slug;
          selectedSlug = game.slug;
        }
      }
      if (key === "slug") selectedSlug = game.slug;
      if (key === "coverUrl") {
        const img = $("cover-preview");
        if (img) {
          img.src = input.value;
          img.hidden = !input.value;
        }
      }
      if (key === "name") root.querySelector(".editor-heading h1").textContent = input.value || "Nuevo juego";
      if (key === "slug") root.querySelector(".editor-heading p").textContent = game.slug + " · " + game.ports.length + " ports";
      if (key === "name" || key === "slug") renderSidebar();
      markUnsavedAndSchedule();
    });
  });

  // Port fields & GitHub paste hooks
  root.querySelectorAll("[data-port-field]").forEach((input) => {
    const idx = Number(input.dataset.portIndex);
    const field = input.dataset.portField;

    input.addEventListener("input", () => {
      const p = game.ports[idx];
      if (!p) return;
      p[field] = input.value;
      if (field === "project") {
        const title = input.closest(".admin-port-card")?.querySelector(".admin-port-title");
        if (title) title.textContent = input.value || "Untitled port";
      }
      markUnsavedAndSchedule();
    });

    input.addEventListener("change", () => {
      if (field === "platform") {
        syncPlatforms(game);
        renderSidebar();
      }
    });

    if (field === "githubRepo" || field === "url") {
      input.addEventListener("paste", (e) => {
        const pasted = e.clipboardData?.getData("text") || "";
        setTimeout(() => {
          const val = pasted.trim() || input.value.trim();
          if (looksLikeGithubUrl(val)) {
            runGithubAutofill(game, idx, val);
          }
        }, 0);
      });
    }
  });

  root.querySelectorAll("[data-lookup-port]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.lookupPort);
      const p = game.ports[idx];
      if (!p) return;
      runGithubAutofill(game, idx, p.githubRepo || p.url);
    });
  });

  root.querySelectorAll("[data-sync-port]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.syncPort);
      const p = game.ports[idx];
      if (!p?.portId) return;
      if (unsavedGame) await saveCurrentGame({ silent: true });
      portUiState.set(idx, { state: "loading", text: "Sincronizando port desde GitHub…" });
      renderEditor();
      try {
        const res = await api("/api/ports/sync", {
          method: "POST",
          body: JSON.stringify({ portId: p.portId }),
        });
        hydrateServerState(res, true);
        const r = res.result || {};
        portUiState.set(idx, {
          state: r.status === "down" ? "error" : "ok",
          text: r.changed
            ? `Actualizado: ${r.newVersion || r.status}`
            : "Sin cambios nuevos en GitHub.",
        });
        renderSidebar();
        renderEditor();
      } catch (error) {
        portUiState.set(idx, { state: "error", text: error.message });
        renderEditor();
      }
    });
  });

  root.querySelectorAll("[data-apply-port-diff]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.applyPortDiff);
      const ui = portUiState.get(idx);
      const p = game.ports[idx];
      if (!ui?.diff || !p) return;
      Object.assign(p, ui.diff.values);
      ui.diff = null;
      renderEditor();
      renderSidebar();
      await saveCurrentGame({ silent: true });
    });
  });

  root.querySelectorAll("[data-dismiss-port-diff]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.dismissPortDiff);
      const ui = portUiState.get(idx);
      if (ui) ui.diff = null;
      renderEditor();
    });
  });

  root.querySelectorAll("[data-undo-port-fill]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.undoPortFill);
      const ui = portUiState.get(idx);
      if (!ui?.undo) return;
      game.ports[idx] = ui.undo;
      portUiState.set(idx, { state: "", text: "Autocompletado revertido." });
      renderEditor();
      renderSidebar();
      await saveCurrentGame({ silent: true });
    });
  });

  root.querySelectorAll("[data-delete-port]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.deletePort);
      if (!confirm("¿Eliminar este port?")) return;
      game.ports.splice(idx, 1);
      portUiState.clear();
      syncPlatforms(game);
      renderEditor();
      renderSidebar();
      await saveCurrentGame({ silent: true });
    });
  });

  $("add-port")?.addEventListener("click", async () => {
    const i = game.ports.length + 1;
    game.ports.push({
      portId: `${game.slug}-port-${Date.now().toString(36)}-${i}`,
      project: "",
      platform: catalog.platformOrder[0] || "",
      developer: "",
      year: game.year || "",
      version: "",
      controller: "",
      files: "",
      works: "",
      link: "",
      url: "",
      dataUrl: "",
      githubRepo: "",
      githubStatus: "",
      lastUpdate: "",
      dateAdded: new Date().toISOString().slice(0, 10),
      notes: "",
    });
    syncPlatforms(game);
    renderEditor();
    renderSidebar();
    await saveCurrentGame({ silent: true });
  });
}

// Sync Modal Logic
function renderSyncModal() {
  $("stat-gh-total").textContent = String(stats.githubCount || 0);
  $("stat-gh-down").textContent = String(stats.downCount || 0);
  $("stat-last-sync").textContent = formatShortDate(stats.lastSyncAt);
  $("stat-last-publish").textContent = formatShortDate(stats.lastGitHubPublishAt);

  const hist = $("sync-history-list");
  if (!syncLogs.length) {
    hist.innerHTML = '<div class="sync-log-row"><span>Todavía no hay corridas registradas.</span></div>';
    return;
  }
  hist.innerHTML = syncLogs
    .map(
      (l) =>
        '<div class="sync-log-row"><div><strong>' +
        esc(l.source === "cron" ? "Cron automático" : "Manual") +
        "</strong> · " +
        esc(formatShortDate(l.createdAt)) +
        '</div><div class="tabular">Revisados: ' +
        l.checkedCount +
        " · Actualizados: " +
        l.updatedCount +
        " · Caídos: " +
        l.downCount +
        "</div></div>"
    )
    .join("");
}

function appendSyncResults(items) {
  const box = $("sync-live-results");
  if (!items || !items.length) return;
  box.hidden = false;
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "sync-result-row";
    const statusLabel =
      item.status === "down"
        ? "CAÍDO (404)"
        : item.status === "error"
        ? "ERROR"
        : item.newVersion
        ? `${item.oldVersion || "?"} → ${item.newVersion}`
        : item.status;
    row.innerHTML =
      "<span>" +
      esc(item.project || item.githubRepo || item.portId) +
      '</span><span class="tabular">' +
      esc(statusLabel) +
      "</span>";
    box.prepend(row);
  }
}

async function runBatchSync(allBatches = false) {
  const btnBatch = $("run-sync-batch");
  const btnAll = $("run-sync-all");
  const progressWrap = $("sync-progress-wrap");
  const progressBar = $("sync-progress-bar");
  const progressText = $("sync-progress-text");
  const progressPct = $("sync-progress-pct");
  const liveBox = $("sync-live-results");

  btnBatch.disabled = true;
  btnAll.disabled = true;
  liveBox.innerHTML = "";
  liveBox.hidden = true;
  progressWrap.hidden = false;

  let offset = 0;
  let totalChecked = 0;
  let totalUpdated = 0;
  let totalDown = 0;

  try {
    do {
      progressText.textContent = allBatches
        ? `Revisando repositorios desde #${offset + 1}…`
        : "Revisando lote de 20 repositorios más antiguos…";
      const res = await api("/api/sync-github", {
        method: "POST",
        body: JSON.stringify({
          limit: 20,
          offset,
          useOffset: allBatches,
        }),
      });
      hydrateServerState(res, true);
      const s = res.sync;
      totalChecked += s.checkedCount;
      totalUpdated += s.updatedCount;
      totalDown += s.downCount;
      offset = s.nextOffset;

      const pct = s.totalGithubPorts
        ? Math.min(100, Math.round(((allBatches ? offset : s.checkedCount) / (allBatches ? s.totalGithubPorts : s.checkedCount || 1)) * 100))
        : 100;
      progressBar.style.width = pct + "%";
      progressPct.textContent = pct + "%";
      appendSyncResults(s.details);
      renderSyncModal();

      if (!allBatches || !s.hasMore) break;
    } while (true);

    progressText.textContent = `Completado: ${totalChecked} revisados · ${totalUpdated} actualizados · ${totalDown} caídos.`;
    progressBar.style.width = "100%";
    progressPct.textContent = "100%";
    renderSidebar();
    renderEditor();
  } catch (error) {
    progressText.textContent = "Error durante sincronización: " + error.message;
  } finally {
    btnBatch.disabled = false;
    btnAll.disabled = false;
  }
}

// Global UI Bindings
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("login-message").className = "message";
  $("login-message").textContent = "Verificando…";
  try {
    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password: $("admin-password").value }),
    });
    token = result.token;
    sessionStorage.setItem("napl_admin_session", token);
    $("admin-password").value = "";
    $("login-message").textContent = "Acceso correcto";
    $("login-message").className = "message success";
    await new Promise((resolve) => setTimeout(resolve, 400));
    showAdmin();
    await loadCatalog();
  } catch (error) {
    $("login-message").textContent = error.message;
  }
});

$("game-search").addEventListener("input", renderSidebar);

$("sidebar-filters").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-filter]");
  if (!btn) return;
  sidebarFilter = btn.dataset.filter;
  $("sidebar-filters").querySelectorAll(".filter-tab").forEach((b) => {
    b.classList.toggle("active", b === btn);
  });
  renderSidebar();
});

$("new-game-button").addEventListener("click", async () => {
  if (unsavedGame) await saveCurrentGame({ silent: true });
  let base = "nuevo-juego";
  let slug = base;
  let n = 2;
  while (gameBySlug(slug)) slug = `${base}-${n++}`;

  const newGame = {
    name: "Nuevo juego",
    slug,
    year: "",
    coverUrl: "",
    genre: "",
    description: "",
    launchboxUrl: "",
    platforms: [],
    ports: [],
  };

  try {
    const res = await api("/api/games", {
      method: "POST",
      body: JSON.stringify({ game: newGame }),
    });
    selectedSlug = res.saved?.slug || slug;
    hydrateServerState(res, true);
    launchboxStatus = { state: "", text: "", diff: null, undo: null };
    portUiState.clear();
    renderSidebar();
    renderEditor();
    setNotice("Nuevo juego creado en D1. Pegá una URL de LaunchBox para autocompletarlo.", "success");
  } catch (error) {
    setNotice("No se pudo crear el juego: " + error.message, "error");
  }
});

$("sync-github-button").addEventListener("click", () => {
  renderSyncModal();
  $("sync-modal").showModal();
});

$("close-sync-modal").addEventListener("click", () => {
  $("sync-modal").close();
});

$("run-sync-batch").addEventListener("click", () => runBatchSync(false));
$("run-sync-all").addEventListener("click", () => runBatchSync(true));

$("import-button").addEventListener("click", async () => {
  if (!confirm("Se importará la hoja CSV oficial hacia D1 reemplazando el catálogo actual. ¿Continuar?")) {
    return;
  }
  const btn = $("import-button");
  btn.disabled = true;
  btn.textContent = "Importando…";
  try {
    const result = await api("/api/import-sheets", { method: "POST", body: "{}" });
    hydrateServerState(result, false);
    unsavedGame = false;
    updateTopState();
    renderSidebar();
    renderEditor();
    setNotice(
      `CSV importado a D1: ${result.summary.games} juegos · ${result.summary.ports} ports. Podés publicar el respaldo en GitHub cuando quieras.`,
      "success"
    );
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Importar CSV";
  }
});

$("download-button").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(catalog, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "napl-catalog.json";
  a.click();
  URL.revokeObjectURL(url);
});

$("publish-button").addEventListener("click", async () => {
  if (unsavedGame) await saveCurrentGame({ silent: true });
  if (!confirm("Se sincronizará la instantánea de D1 hacia catalog.json en GitHub/respaldo. ¿Continuar?")) {
    return;
  }
  const btn = $("publish-button");
  btn.disabled = true;
  btn.textContent = "Publicando…";
  try {
    const result = await api("/api/publish", { method: "POST", body: "{}" });
    hydrateServerState(result, true);
    unsavedGame = false;
    updateTopState();
    const msg = result.commit
      ? "Respaldo publicado en GitHub correctamente."
      : "Catálogo JSON local sincronizado desde la base de datos.";
    setNotice(msg, "success");
    if (result.commit) {
      const a = document.createElement("a");
      a.href = result.commit;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "Abrir commit";
      a.style.marginLeft = "8px";
      $("notice").append(a);
    }
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    btn.textContent = "Publicar en GitHub";
    updateTopState();
  }
});

$("logout-button").addEventListener("click", () => {
  token = "";
  sessionStorage.removeItem("napl_admin_session");
  showLogin();
});

window.addEventListener("beforeunload", (event) => {
  if (unsavedGame) {
    event.preventDefault();
    event.returnValue = "";
  }
});

async function init() {
  try {
    const health = await fetch(API + "/api/health").then((r) => r.json());
    if (health.localMode && !health.hasCustomPassword) {
      const hint = $("login-hint");
      hint.textContent = "Vista previa local activa (SQLite D1-parity). Contraseña por defecto: admin";
      hint.hidden = false;
    } else if (!health.configured?.adminPassword || !health.configured?.sessionSecret) {
      $("login-message").textContent =
        "El backend todavía necesita configurar ADMIN_PASSWORD, SESSION_SECRET y el binding D1 (DB) en Cloudflare.";
      return;
    }
  } catch {
    $("login-message").textContent = "No se pudo conectar con el backend de administración.";
    return;
  }

  if (token) {
    showAdmin();
    try {
      await loadCatalog();
    } catch (error) {
      if (!token) {
        $("login-message").textContent = error.message;
      } else {
        setNotice("No se pudo cargar el catálogo: " + error.message, "error");
      }
    }
    return;
  }
  showLogin();
}

init();