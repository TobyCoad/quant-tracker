/* quant-tracker main UI */
"use strict";

/* ---------------- state ---------------- */

/* Pipeline statuses are data, not constants: user-editable, synced to
 * tracker/statuses.json. `dead` = likely dead end (dims card, excluded
 * from "in play"). Seeds use a FIXED timestamp so remote edits always win. */
const PALETTE = {
  grey:   { bg: "#262115", fg: "#b3a88f" },
  blue:   { bg: "#0d2b36", fg: "#6fd0ef" },
  amber:  { bg: "#3a2c07", fg: "#ffd166" },
  violet: { bg: "#2c2144", fg: "#d3bcff" },
  green:  { bg: "#0c3320", fg: "#55efa0" },
  red:    { bg: "#3a1210", fg: "#ff8a80" },
  teal:   { bg: "#0d3330", fg: "#5eead4" },
  pink:   { bg: "#331328", fg: "#ff9ad5" },
  slate:  { bg: "#1c2333", fg: "#9fb3d1" },
  ash:    { bg: "#2a2222", fg: "#a09090" },
};
const SEED_TS = "2026-08-08T00:00:00.000Z";
const DEFAULT_STATUSES = [
  ["offer",          "Offer",          "green",  false],
  ["interview",      "Interview",      "violet", false],
  ["recruiter_call", "Recruiter call", "teal",   false],
  ["call_done",      "Call done",      "slate",  false],
  ["oa",             "OA",             "amber",  false],
  ["oa_done",        "OA done",        "pink",   false],
  ["applied",        "Applied",        "blue",   false],
  ["not_applied",    "Not applied",    "grey",   false],
  ["ghosted",        "Ghosted",        "ash",    true],
  ["rejected",       "Rejected",       "red",    true],
].map(([id, label, color, dead], i) =>
  ({ id, label, color, dead, ord: (i + 1) * 10, created: SEED_TS, updated: SEED_TS }));
const CAT_LABEL = {
  summer_internship: "INTERN", graduate: "GRAD", spring_week: "SPRING",
  off_cycle: "OFF-CYCLE", other: "OTHER",
};

let apps = loadJSON("qt.apps", []);
let firms = loadJSON("qt.firms", []);
let statuses = loadJSON("qt.statuses", []);
if (!statuses.length) statuses = JSON.parse(JSON.stringify(DEFAULT_STATUSES));
let feed = loadJSON("qt.feed", null);          // {lastRun, roles, fetchedAt}
let pipelineFilter = "all";
let firmFilter = "all";
let currentTab = "pipeline";
let scoutFilter = "new";
let scoutSearch = "";
let editingId = null;                          // app id being edited, or null = new
let syncTimer = null;
let syncing = false;

const $ = (id) => document.getElementById(id);

function loadJSON(k, fb) {
  try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; }
}
function saveJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    "id-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}
function nowIso() { return new Date().toISOString(); }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function toast(msg, ms = 2200) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), ms);
}

const liveApps = () => apps.filter((a) => !a.deleted);
const liveStatuses = () =>
  statuses.filter((s) => !s.deleted).sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
const statusDef = (id) =>
  statuses.find((s) => s.id === id && !s.deleted) ||
  { id, label: id, color: "grey", dead: false, ord: 999 };
const statusColor = (id) => PALETTE[statusDef(id).color] || PALETTE.grey;

/* ---------------- pipeline tab ---------------- */

function renderPipeline() {
  const live = liveApps();
  const counts = {};
  for (const a of live) counts[a.status] = (counts[a.status] || 0) + 1;

  // summary line: "in play" = not a dead-end status and actually applied
  const active = live.filter((a) => {
    const d = statusDef(a.status);
    return !d.dead && a.status !== "not_applied";
  }).length;
  $("pipeline-summary").innerHTML = live.length
    ? `<b>${live.length}</b> tracked &nbsp;·&nbsp; <b>${active}</b> in play` +
      (counts.interview ? ` &nbsp;·&nbsp; <b>${counts.interview}</b> interview` : "") +
      (counts.oa ? ` &nbsp;·&nbsp; <b>${counts.oa}</b> OA` : "")
    : "";

  // filter chips
  const chips = [["all", `All<span class="n">${live.length}</span>`]];
  for (const s of liveStatuses()) {
    if (counts[s.id]) chips.push([s.id, `${esc(s.label)}<span class="n">${counts[s.id]}</span>`]);
  }
  $("pipeline-filters").innerHTML = chips.map(([k, html]) =>
    `<button class="chip ${pipelineFilter === k ? "active" : ""}" data-f="${k}">${html}</button>`).join("");
  $("pipeline-filters").querySelectorAll(".chip").forEach((c) =>
    c.onclick = () => { pipelineFilter = c.dataset.f; renderPipeline(); });

  // cards
  const shown = live
    .filter((a) => pipelineFilter === "all" || a.status === pipelineFilter)
    .sort((a, b) => {
      const d = statusDef(a.status).ord - statusDef(b.status).ord;
      return d !== 0 ? d : (b.updated || "").localeCompare(a.updated || "");
    });

  $("apps-list").innerHTML = shown.map((a) => {
    const def = statusDef(a.status);
    const c = PALETTE[def.color] || PALETTE.grey;
    return `
    <div class="card ${def.dead ? "dim" : ""}" style="border-left-color:${c.fg}" data-id="${a.id}">
      <div class="card-top">
        <div>
          <div class="card-firm">${esc(a.firm)}</div>
          ${a.role ? `<div class="card-role">${esc(a.role)}</div>` : ""}
        </div>
        <span class="pill" style="background:${c.bg};color:${c.fg}">${esc(def.label)}</span>
      </div>
      ${a.notes ? `<div class="card-sub">✎ ${esc(a.notes.length > 70 ? a.notes.slice(0, 70) + "…" : a.notes)}</div>` : ""}
    </div>`;
  }).join("");
  $("apps-list").querySelectorAll(".card").forEach((c) =>
    c.onclick = () => openEdit(c.dataset.id));

  $("pipeline-empty").classList.toggle("hidden", live.length > 0);
}

/* ---------------- edit sheet ---------------- */

function buildStatusPicker(sel) {
  $("f-status").innerHTML = liveStatuses().map((s) => {
    const c = PALETTE[s.color] || PALETTE.grey;
    const st = s.id === sel ? ` style="background:${c.bg};color:${c.fg};border-color:${c.fg}"` : "";
    return `<button type="button" class="status-opt ${s.id === sel ? "sel" : ""}"${st} data-s="${s.id}">${esc(s.label)}</button>`;
  }).join("") +
  `<button type="button" class="status-opt st-edit" data-add="1">✎ edit…</button>`;
  $("f-status").querySelectorAll(".status-opt").forEach((b) =>
    b.onclick = () => b.dataset.add ? openStatusManager() : buildStatusPicker(b.dataset.s));
}
const pickedStatus = () =>
  $("f-status").querySelector(".sel")?.dataset.s || liveStatuses()[0]?.id || "not_applied";

function openEdit(id, prefill) {
  editingId = id;
  const a = id ? apps.find((x) => x.id === id) : null;
  $("edit-title").textContent = a ? "Edit application" : "Track application";
  $("f-firm").value = a?.firm ?? prefill?.firm ?? "";
  $("f-role").value = a?.role ?? prefill?.role ?? "";
  $("f-url").value = a?.url ?? prefill?.url ?? "";
  $("f-notes").value = a?.notes ?? "";
  buildStatusPicker(a?.status ?? prefill?.status ?? "not_applied");
  $("f-delete").classList.toggle("hidden", !a);
  openSheet("edit-sheet");
}

function saveEdit() {
  const firm = $("f-firm").value.trim();
  if (!firm) { toast("Firm is required"); return; }
  const fields = {
    firm, role: $("f-role").value.trim(), status: pickedStatus(),
    url: $("f-url").value.trim(), notes: $("f-notes").value.trim(),
    updated: nowIso(),
  };
  if (editingId) {
    const a = apps.find((x) => x.id === editingId);
    Object.assign(a, fields);
  } else {
    apps.push({ id: uid(), created: nowIso(), sourceRoleId: sheetPrefillRoleId, ...fields });
  }
  sheetPrefillRoleId = null;
  persistApps();
  closeSheets();
  renderAll();
}

function deleteEdit() {
  const a = apps.find((x) => x.id === editingId);
  if (a) { a.deleted = true; a.updated = nowIso(); }
  persistApps();
  closeSheets();
  renderAll();
  toast("Deleted");
}

/* ---------------- scout tab ---------------- */

function trackedRoleKeys() {
  const keys = new Set();
  for (const a of liveApps()) {
    if (a.sourceRoleId) keys.add(a.sourceRoleId);
    if (a.url) keys.add(a.url);
  }
  return keys;
}

function newCutoffIso() { return new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10); }

function renderScout() {
  const banner = $("scout-run-info");
  if (!feed) {
    banner.innerHTML = GH.hasToken()
      ? `Feed not loaded yet — tap ↻ to fetch.`
      : `Connect GitHub in <b>settings ⚙</b> to load the daily scout feed.`;
    $("scout-filters").innerHTML = "";
    $("scout-list").innerHTML = "";
    $("scout-empty").classList.add("hidden");
    return;
  }

  const run = feed.lastRun || {};
  const today = new Date().toISOString().slice(0, 10);
  const stale = run.date && run.date < new Date(Date.now() - 864e5 * 2).toISOString().slice(0, 10);
  banner.innerHTML =
    `<span class="run-date ${stale ? "warn" : "ok"}">Scout ran ${run.date === today ? "today" : fmtDate(run.date)}</span>` +
    ` · ${run.new_roles ?? "?"} new role${run.new_roles === 1 ? "" : "s"}` +
    `<span class="muted"> · feed ${fmtDate(feed.fetchedAt)} ${new Date(feed.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>` +
    (stale ? ` <span class="warn">— check scout!</span>` : "");

  const cutoff = newCutoffIso();
  const roles = feed.roles || [];
  const nNew = roles.filter((r) => r.first_seen >= cutoff).length;
  const nIntern = roles.filter((r) => ["summer_internship", "spring_week", "off_cycle"].includes(r.category)).length;
  const nGrad = roles.filter((r) => r.category === "graduate").length;

  const nToday = run.date ? roles.filter((r) => r.first_seen >= run.date).length : 0;
  const chips = [
    ["today", `Today<span class="n">${nToday}</span>`],
    ["new", `New 7d<span class="n">${nNew}</span>`],
    ["intern", `Interns<span class="n">${nIntern}</span>`],
    ["grad", `Grads<span class="n">${nGrad}</span>`],
    ["all", `All<span class="n">${roles.length}</span>`],
  ];
  $("scout-filters").innerHTML = chips.map(([k, html]) =>
    `<button class="chip ${scoutFilter === k ? "active" : ""}" data-f="${k}">${html}</button>`).join("");
  $("scout-filters").querySelectorAll(".chip").forEach((c) =>
    c.onclick = () => { scoutFilter = c.dataset.f; renderScout(); });

  const tracked = trackedRoleKeys();
  const q = scoutSearch.toLowerCase();
  const shown = roles.filter((r) => {
    if (scoutFilter === "today" && !(run.date && r.first_seen >= run.date)) return false;
    if (scoutFilter === "new" && r.first_seen < cutoff) return false;
    if (scoutFilter === "intern" && !["summer_internship", "spring_week", "off_cycle"].includes(r.category)) return false;
    if (scoutFilter === "grad" && r.category !== "graduate") return false;
    if (q && !`${r.title} ${r.company} ${r.location}`.toLowerCase().includes(q)) return false;
    return true;
  }).slice(0, 150);

  $("scout-list").innerHTML = shown.map((r, i) => {
    const isTracked = tracked.has(r.id) || (r.url && tracked.has(r.url));
    const fitCls = r.fit == null ? "lo" : r.fit >= 70 ? "hi" : r.fit >= 50 ? "mid" : "lo";
    const isNew = run.date && r.first_seen >= run.date;
    return `
    <div class="card role-card" data-i="${i}">
      <div class="role-head">
        <div class="role-main">
          <div class="role-title">${esc(r.title)}</div>
          <div class="role-co">${esc(r.company)}${r.location ? " · " + esc(r.location) : ""}</div>
        </div>
        <span class="fit ${fitCls}">${r.fit ?? "–"}</span>
      </div>
      <div class="role-tags">
        ${isNew ? `<span class="tag new">NEW</span>` : ""}
        <span class="tag cat-${r.category}">${CAT_LABEL[r.category] || r.category}</span>
        <span class="tag">seen ${fmtDate(r.first_seen)}</span>
        ${r.red_flags.length ? `<span class="tag">⚑ ${r.red_flags.length}</span>` : ""}
      </div>
      ${r.one_line ? `<div class="role-line">${esc(r.one_line)}</div>` : ""}
      <div class="role-actions">
        <a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Apply ↗</a>
        <button class="btn sm ${isTracked ? "done" : ""}" data-track="${i}" ${isTracked ? "disabled" : ""}>
          ${isTracked ? "Tracked ✓" : "+ Track"}
        </button>
      </div>
    </div>`;
  }).join("");

  $("scout-list").querySelectorAll(".role-card").forEach((c) =>
    c.onclick = () => openRoleDetail(shown[+c.dataset.i]));
  $("scout-list").querySelectorAll("[data-track]").forEach((b) =>
    b.onclick = (e) => { e.stopPropagation(); trackRole(shown[+b.dataset.track]); });

  $("scout-empty").classList.toggle("hidden", shown.length > 0);
  $("scout-empty-hint").textContent =
    scoutFilter === "today" ? `Nothing new from the latest run (${fmtDate(run.date)}) — try New 7d.` :
    scoutFilter === "new" ? "Nothing first seen in the last 7 days — try All." : "";

  // badge: roles first seen on the latest run date
  const todayNew = roles.filter((r) => run.date && r.first_seen >= run.date).length;
  $("scout-badge").textContent = todayNew;
  $("scout-badge").classList.toggle("hidden", !todayNew);
}

let sheetPrefillRoleId = null;
function trackRole(r) {
  sheetPrefillRoleId = r.id;
  openEdit(null, { firm: r.company, role: r.title, url: r.url, status: "not_applied" });
}

function openRoleDetail(r) {
  const li = (arr) => arr.map((x) => `<li>${esc(x)}</li>`).join("");
  $("role-detail").innerHTML = `
    <h2>${esc(r.title)}</h2>
    <div class="co">${esc(r.company)}${r.location ? " · " + esc(r.location) : ""}
      · first seen ${fmtDate(r.first_seen)}</div>
    <div class="role-tags">
      <span class="tag cat-${r.category}">${CAT_LABEL[r.category] || r.category}</span>
      ${r.fit != null ? `<span class="tag">fit ${r.fit}</span>` : ""}
      ${r.season_fit ? `<span class="tag">${esc(r.season_fit)}</span>` : ""}
      ${r.best_cv ? `<span class="tag">CV: ${esc(r.best_cv)}</span>` : ""}
    </div>
    ${r.reasons.length ? `<div class="sec">Why it fits</div><ul>${li(r.reasons)}</ul>` : ""}
    ${r.red_flags.length ? `<div class="sec">Red flags</div><ul class="flags">${li(r.red_flags)}</ul>` : ""}
    ${r.desc ? `<div class="sec">Description</div><div class="desc">${esc(r.desc)}…</div>` : ""}
    <div class="sheet-actions">
      <a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">Open posting ↗</a>
      <button class="btn primary" id="rd-track">+ Track</button>
    </div>`;
  $("rd-track").onclick = () => { closeSheets(); trackRole(r); };
  openSheet("role-sheet");
}

async function refreshFeed(silent) {
  if (!GH.hasToken()) { if (!silent) openSettings(); return; }
  $("btn-refresh").classList.add("spin");
  try {
    feed = await GH.fetchFeed();
    saveJSON("qt.feed", feed);
    renderScout();
    if (!silent) toast("Scout feed updated");
  } catch (e) {
    if (!silent) toast(e.message.startsWith("auth")
      ? `Token lacks Contents access (${e.message.slice(5)}) — check settings`
      : `Feed refresh failed: ${e.message}`, 4000);
  } finally {
    $("btn-refresh").classList.remove("spin");
  }
}

/* ---------------- status manager ---------------- */

function openStatusManager() {
  // stacks above the edit sheet (later in DOM) so form values survive
  renderStatusRows();
  $("sheet-backdrop").classList.remove("hidden");
  $("status-sheet").classList.remove("hidden");
}

function closeStatusManager() {
  $("status-sheet").classList.add("hidden");
  if ($("edit-sheet").classList.contains("hidden")) closeSheets();
  else buildStatusPicker(pickedStatus());      // refresh picker under it
  renderPipeline();
}

function renderStatusRows() {
  const inUse = new Set(liveApps().map((a) => a.status));
  const list = liveStatuses();
  $("status-rows").innerHTML = list.map((s, i) => {
    const c = PALETTE[s.color] || PALETTE.grey;
    return `
    <div class="st-row" data-id="${s.id}">
      <button class="swatch" data-act="color" title="colour"
        style="background:${c.bg};border-color:${c.fg}"></button>
      <input class="st-label" data-act="label" value="${esc(s.label)}" maxlength="24">
      <button class="st-btn ${s.dead ? "on" : ""}" data-act="dead" title="dead end — dims card, not counted in play">☠</button>
      <button class="st-btn" data-act="up" ${i === 0 ? "disabled" : ""} title="move up">↑</button>
      <button class="st-btn" data-act="del" ${inUse.has(s.id) ? "disabled" : ""}
        title="${inUse.has(s.id) ? "in use — reassign those applications first" : "delete"}">✕</button>
    </div>`;
  }).join("");

  $("status-rows").querySelectorAll(".st-row").forEach((row) => {
    const s = statuses.find((x) => x.id === row.dataset.id);
    const touch = () => { s.updated = nowIso(); persistStatuses(); };
    row.querySelector('[data-act="color"]').onclick = () => {
      const keys = Object.keys(PALETTE);
      s.color = keys[(keys.indexOf(s.color) + 1) % keys.length];
      touch(); renderStatusRows();
    };
    row.querySelector('[data-act="label"]').onchange = (e) => {
      const v = e.target.value.trim();
      if (v) { s.label = v; touch(); } else e.target.value = s.label;
    };
    row.querySelector('[data-act="dead"]').onclick = () => {
      s.dead = !s.dead; touch(); renderStatusRows();
    };
    row.querySelector('[data-act="up"]').onclick = () => {
      const list = liveStatuses();
      const i = list.findIndex((x) => x.id === s.id);
      const prev = list[i - 1];
      [s.ord, prev.ord] = [prev.ord, s.ord];
      s.updated = prev.updated = nowIso();
      persistStatuses(); renderStatusRows();
    };
    row.querySelector('[data-act="del"]').onclick = () => {
      if (liveStatuses().length <= 1) { toast("Need at least one status"); return; }
      s.deleted = true; touch(); renderStatusRows();
    };
  });
}

function addStatus() {
  const label = $("st-new").value.trim();
  if (!label) return;
  const used = new Set(liveStatuses().map((s) => s.color));
  const color = Object.keys(PALETTE).find((k) => !used.has(k)) || "grey";
  const maxOrd = Math.max(0, ...liveStatuses().map((s) => s.ord ?? 0));
  statuses.push({
    id: "s-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
       + "-" + Math.random().toString(36).slice(2, 6),
    label, color, dead: false, ord: maxOrd + 10,
    created: nowIso(), updated: nowIso(),
  });
  $("st-new").value = "";
  persistStatuses();
  renderStatusRows();
}

function persistStatuses() {
  saveJSON("qt.statuses", statuses);
  scheduleSync();
}

/* ---------------- firms tab ---------------- */

const FIRM_STATUS_ORDER = ["posted", "waiting", "applied", "pass"];
const FIRM_STATUS_LABEL = { posted: "Posted!", waiting: "Waiting", applied: "Applied", pass: "Pass" };
const FIRM_TYPE_LABEL = { prop: "PROP / MM", hf: "HEDGE FUND", sell: "SELL-SIDE" };
const EARLY_CATS = ["graduate", "summer_internship", "spring_week", "off_cycle"];
const TARGET_LOCS = ["london", "dublin", "amsterdam", "united kingdom", "ireland", "netherlands"];

// grad/intern roles in target cities from the scout feed matching this firm
function firmFeedRoles(f) {
  if (!feed?.roles || !f.match?.length) return [];
  return feed.roles.filter((r) => {
    const co = (r.company || "").toLowerCase();
    if (!f.match.some((m) => co.includes(m))) return false;
    if (f.not?.some((m) => co.includes(m))) return false;
    if (!EARLY_CATS.includes(r.category)) return false;
    const loc = (r.location || "").toLowerCase();
    return TARGET_LOCS.some((t) => loc.includes(t));
  });
}

function renderFirms() {
  const live = firms.filter((f) => !f.deleted);
  const matches = new Map(live.map((f) => [f.id, firmFeedRoles(f)]));

  const counts = {};
  for (const f of live) counts[f.status] = (counts[f.status] || 0) + 1;
  const alerts = live.filter((f) => f.status === "waiting" && matches.get(f.id).length).length;

  $("firms-summary").innerHTML = live.length
    ? `<b>${counts.waiting || 0}</b> waiting &nbsp;·&nbsp; <b>${counts.posted || 0}</b> posted` +
      (alerts ? ` &nbsp;·&nbsp; <span style="color:var(--green)"><b>${alerts}</b> waiting firm${alerts === 1 ? " has" : "s have"} roles in the feed</span>` : "")
    : "";

  const chips = [["all", `All<span class="n">${live.length}</span>`]];
  for (const s of FIRM_STATUS_ORDER)
    if (counts[s]) chips.push([s, `${FIRM_STATUS_LABEL[s]}<span class="n">${counts[s]}</span>`]);
  $("firms-filters").innerHTML = chips.map(([k, html]) =>
    `<button class="chip ${firmFilter === k ? "active" : ""}" data-f="${k}">${html}</button>`).join("");
  $("firms-filters").querySelectorAll(".chip").forEach((c) =>
    c.onclick = () => { firmFilter = c.dataset.f; renderFirms(); });

  const shown = live
    .filter((f) => firmFilter === "all" || f.status === firmFilter)
    .sort((a, b) => {
      const am = matches.get(a.id).length ? 0 : 1;      // feed hits float up
      const bm = matches.get(b.id).length ? 0 : 1;
      if (am !== bm) return am - bm;
      const d = FIRM_STATUS_ORDER.indexOf(a.status) - FIRM_STATUS_ORDER.indexOf(b.status);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });

  $("firms-list").innerHTML = shown.map((f) => {
    const m = matches.get(f.id);
    return `
    <div class="card s-firm-${f.status} ${f.status === "pass" ? "dim" : ""}" data-id="${f.id}">
      <div class="card-top">
        <div>
          <div class="card-firm">${esc(f.name)}</div>
          <div class="card-role"><span class="tag ft-${f.type}">${FIRM_TYPE_LABEL[f.type] || ""}</span></div>
        </div>
        <span class="pill f-${f.status}">${FIRM_STATUS_LABEL[f.status]}</span>
      </div>
      ${f.notes ? `<div class="card-sub">✎ ${esc(f.notes)}</div>` : ""}
      <div class="role-actions">
        ${f.url ? `<a class="btn sm" href="${esc(f.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Careers ↗</a>` : ""}
        ${m.length ? `<button class="btn sm livehint" data-feed="${f.id}">${m.length} in feed →</button>` : ""}
      </div>
    </div>`;
  }).join("");

  $("firms-list").querySelectorAll(".card").forEach((c) =>
    c.onclick = () => openFirmEdit(c.dataset.id));
  $("firms-list").querySelectorAll("[data-feed]").forEach((b) =>
    b.onclick = (e) => {
      e.stopPropagation();
      const f = firms.find((x) => x.id === b.dataset.feed);
      scoutSearch = f.match?.[0] || f.name;
      scoutFilter = "all";
      $("scout-search").value = scoutSearch;
      switchTab("scout");
      renderScout();
    });

  $("firms-empty").classList.toggle("hidden", live.length > 0);
  $("firms-badge").textContent = alerts;
  $("firms-badge").classList.toggle("hidden", !alerts);
}

/* ---- firm edit sheet ---- */

let editingFirmId = null;

function buildFirmPicker(elId, opts, labels, sel) {
  $(elId).innerHTML = opts.map((s) =>
    `<button type="button" class="status-opt f-${s} ${s === sel ? "sel" : ""}" data-s="${s}">${labels[s]}</button>`).join("");
  $(elId).querySelectorAll(".status-opt").forEach((b) =>
    b.onclick = () => buildFirmPicker(elId, opts, labels, b.dataset.s));
}
const pickedFirm = (elId, fb) => $(elId).querySelector(".sel")?.dataset.s || fb;

function openFirmEdit(id) {
  editingFirmId = id;
  const f = id ? firms.find((x) => x.id === id) : null;
  $("firm-title").textContent = f ? "Edit firm" : "Add firm";
  $("ff-name").value = f?.name ?? "";
  $("ff-url").value = f?.url ?? "";
  $("ff-notes").value = f?.notes ?? "";
  buildFirmPicker("ff-type", ["prop", "hf", "sell"], FIRM_TYPE_LABEL, f?.type ?? "prop");
  buildFirmPicker("ff-status", FIRM_STATUS_ORDER, FIRM_STATUS_LABEL, f?.status ?? "waiting");
  $("ff-delete").classList.toggle("hidden", !f);
  openSheet("firm-sheet");
}

function saveFirmEdit() {
  const name = $("ff-name").value.trim();
  if (!name) { toast("Firm name is required"); return; }
  const fields = {
    name, type: pickedFirm("ff-type", "prop"), status: pickedFirm("ff-status", "waiting"),
    url: $("ff-url").value.trim(), notes: $("ff-notes").value.trim(), updated: nowIso(),
  };
  let f;
  if (editingFirmId) {
    f = firms.find((x) => x.id === editingFirmId);
    Object.assign(f, fields);
  } else {
    f = { id: uid(), created: nowIso(), match: [name.toLowerCase()], ...fields };
    firms.push(f);
  }
  persistFirms();
  closeSheets();
  renderFirms();
  // moved to Applied and not in the pipeline yet? offer to add it
  const inPipeline = liveApps().some((a) =>
    a.firm.toLowerCase().includes(f.match?.[0] || f.name.toLowerCase()));
  if (fields.status === "applied" && !inPipeline &&
      confirm(`Add ${name} to your pipeline as Applied?`)) {
    apps.push({ id: uid(), created: nowIso(), firm: name, role: "", status: "applied",
                url: f.url, notes: "", updated: nowIso() });
    persistApps();
    renderPipeline();
  }
}

function deleteFirmEdit() {
  const f = firms.find((x) => x.id === editingFirmId);
  if (f) { f.deleted = true; f.updated = nowIso(); }
  persistFirms();
  closeSheets();
  renderFirms();
  toast("Deleted");
}

/* ---------------- export ---------------- */

function csvOf(header, rows) {
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  return [header, ...rows].map((r) => r.map(q).join(",")).join("\r\n");
}

async function shareOrDownload(files) {
  if (navigator.canShare?.({ files })) {
    try { await navigator.share({ files }); return; }
    catch (e) { if (e.name === "AbortError") return; }   // user closed the sheet
  }
  for (const f of files) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10e3);
  }
}

function exportCsv() {
  const stamp = new Date().toISOString().slice(0, 10);
  const appRows = liveApps()
    .sort((a, b) => {
      const d = statusDef(a.status).ord - statusDef(b.status).ord;
      return d !== 0 ? d : a.firm.localeCompare(b.firm);
    })
    .map((a) => [a.firm, a.role, statusDef(a.status).label, a.notes, a.url,
                 (a.created || "").slice(0, 10), (a.updated || "").slice(0, 10)]);
  const firmRows = firms.filter((f) => !f.deleted)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => [f.name, FIRM_TYPE_LABEL[f.type] || f.type,
                 FIRM_STATUS_LABEL[f.status] || f.status, f.notes, f.url]);
  shareOrDownload([
    new File([csvOf(["Firm", "Role", "Status", "Notes", "Link", "Created", "Updated"], appRows)],
      `applications-${stamp}.csv`, { type: "text/csv" }),
    new File([csvOf(["Firm", "Type", "Status", "Notes", "Careers URL"], firmRows)],
      `firm-watchlist-${stamp}.csv`, { type: "text/csv" }),
  ]);
}

function exportJson() {
  const stamp = new Date().toISOString().slice(0, 10);
  const payload = JSON.stringify(
    { version: 1, exported: nowIso(), apps, firms, statuses }, null, 1);
  shareOrDownload([new File([payload], `quant-tracker-backup-${stamp}.json`,
    { type: "application/json" })]);
}

/* ---------------- sync ---------------- */

function persistApps() {
  saveJSON("qt.apps", apps);
  scheduleSync();
}

function persistFirms() {
  saveJSON("qt.firms", firms);
  scheduleSync();
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(true), 1500);
}

async function syncNow(silent) {
  if (!GH.hasToken() || syncing) return;
  syncing = true;
  setSyncStatus("Syncing…");
  try {
    apps = await syncList(apps, GH.appsStore);
    saveJSON("qt.apps", apps);
    firms = await syncList(firms, GH.firmsStore);
    saveJSON("qt.firms", firms);
    statuses = await syncList(statuses, GH.statusesStore);
    if (!statuses.filter((s) => !s.deleted).length)
      statuses = statuses.concat(JSON.parse(JSON.stringify(DEFAULT_STATUSES)));
    saveJSON("qt.statuses", statuses);
    localStorage.setItem("qt.lastSync", nowIso());
    setSyncStatus();
    renderAll();
    if (!silent) toast("Synced");
  } catch (e) {
    setSyncStatus(e.message.startsWith("auth") ? `Token rejected (${e.message.slice(5)})` : `Sync failed: ${e.message}`);
    if (!silent) toast("Sync failed");
  } finally {
    syncing = false;
  }
}

// pull remote, merge (later `updated` wins), push back unless identical
async function syncList(local, store) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { list: remote, sha } = await store.load();
    local = GH.mergeApps(local, remote);
    if (JSON.stringify(local) === JSON.stringify(remote)) break;   // nothing to push
    const res = await store.put(local, sha);
    if (res.ok) break;
    // conflict: loop once more with fresh sha
  }
  return local;
}

function setSyncStatus(msg) {
  const last = localStorage.getItem("qt.lastSync");
  $("s-sync-status").textContent = msg ||
    (last ? `Last synced ${fmtDate(last)} ${new Date(last).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Never synced");
}

/* ---------------- settings ---------------- */

function openSettings() {
  $("s-token").value = localStorage.getItem("qt.token") || "";
  $("s-test-result").textContent = "";
  setSyncStatus();
  openSheet("settings-sheet");
}

function saveSettings() {
  const tok = $("s-token").value.trim();
  if (tok) localStorage.setItem("qt.token", tok);
  else localStorage.removeItem("qt.token");
  closeSheets();
  if (tok) { syncNow(true); refreshFeed(true); }
  renderAll();
}

/* ---------------- sheets / nav ---------------- */

function openSheet(id) {
  closeSheets();
  $("sheet-backdrop").classList.remove("hidden");
  $(id).classList.remove("hidden");
}
function closeSheets() {
  $("sheet-backdrop").classList.add("hidden");
  for (const id of ["edit-sheet", "settings-sheet", "role-sheet", "firm-sheet", "status-sheet"])
    $(id).classList.add("hidden");
}

const TAB_TITLE = { pipeline: "Pipeline", scout: "Role Scout", cv: "CV Manager", firms: "Firm Watch" };

function switchTab(name) {
  currentTab = name;
  document.querySelectorAll(".tabbtn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name));
  for (const t of Object.keys(TAB_TITLE))
    $(`tab-${t}`).classList.toggle("hidden", t !== name);
  $("page-title").textContent = TAB_TITLE[name];
  $("fab").classList.toggle("hidden", name !== "pipeline" && name !== "firms");
  if (name === "scout" && GH.hasToken()) {
    const age = feed ? Date.now() - new Date(feed.fetchedAt).getTime() : Infinity;
    if (age > 30 * 60e3) refreshFeed(true);
  }
  if (name === "cv" && !cvFiles.length) loadCvList();
}

/* ---------------- CV manager ---------------- */

let cvFiles = [];
let cvCur = null;               // { name, sha, baseText }

const cvDraftKey = (name) => `qt.cvdraft.${name}`;

function cvStatus(msg) { $("cv-status").innerHTML = msg; }

async function loadCvList() {
  if (!GH.hasToken()) { cvStatus("Connect GitHub in settings ⚙ to load your CVs."); return; }
  cvStatus("Loading CV list…");
  try {
    cvFiles = await GH.listCv();
  } catch (e) {
    cvStatus(`Couldn't list CVs: ${esc(e.message)}`);
    return;
  }
  if (!cvFiles.length) { cvStatus("No .tex files in tracker/cv yet."); return; }
  renderCvChips();
  selectCv(cvCur?.name && cvFiles.some((f) => f.name === cvCur.name)
    ? cvCur.name : cvFiles[0].name);
}

function renderCvChips() {
  $("cv-files").innerHTML = cvFiles.map((f) =>
    `<button class="chip ${cvCur?.name === f.name ? "active" : ""}" data-cv="${esc(f.name)}">${esc(f.name)}</button>`).join("");
  $("cv-files").querySelectorAll(".chip").forEach((c) =>
    c.onclick = () => selectCv(c.dataset.cv));
}

async function selectCv(name) {
  cvStatus(`Loading <b>${esc(name)}</b>…`);
  try {
    const { text, sha } = await GH.loadCvFile(name);
    cvCur = { name, sha, baseText: text };
    const draft = localStorage.getItem(cvDraftKey(name));
    $("cv-editor").value = draft ?? text;
    renderCvChips();
    updateCvStatus();
  } catch (e) {
    cvStatus(`Couldn't load ${esc(name)}: ${esc(e.message)}`);
  }
}

function updateCvStatus() {
  if (!cvCur) return;
  const dirty = $("cv-editor").value !== cvCur.baseText;
  const n = $("cv-editor").value.length;
  cvStatus(`<b>${esc(cvCur.name)}</b> · ${(n / 1000).toFixed(1)}k chars · ` +
    (dirty ? `<span style="color:var(--amber)">unsaved edits (kept on this device)</span>`
           : `in sync with GitHub`));
}

function cvOnInput() {
  if (!cvCur) return;
  const v = $("cv-editor").value;
  if (v === cvCur.baseText) localStorage.removeItem(cvDraftKey(cvCur.name));
  else localStorage.setItem(cvDraftKey(cvCur.name), v);
  updateCvStatus();
}

function cvCompile() {
  const src = $("cv-editor").value;
  if (!src.trim()) { toast("Nothing to compile"); return; }
  $("cv-form-src").value = src;
  $("cv-form").submit();
  toast("Compiling — PDF opens in a new tab (~10 s)", 3500);
}

async function cvSave() {
  if (!cvCur) return;
  if (GH.MOCK) { toast("Mock mode — not saved"); return; }
  const text = $("cv-editor").value;
  $("cv-save").disabled = true;
  try {
    const res = await GH.saveCvFile(cvCur.name, text, cvCur.sha);
    if (res.conflict) {
      toast("Conflict — file changed on GitHub. Reloading…", 3500);
      localStorage.setItem(cvDraftKey(cvCur.name), text);
      await selectCv(cvCur.name);
      return;
    }
    cvCur.sha = res.sha;
    cvCur.baseText = text;
    localStorage.removeItem(cvDraftKey(cvCur.name));
    updateCvStatus();
    toast("Saved to GitHub ✓");
  } catch (e) {
    toast(`Save failed: ${e.message}`, 4000);
  } finally {
    $("cv-save").disabled = false;
  }
}

function cvRevert() {
  if (!cvCur) return;
  if (!confirm(`Discard local edits to ${cvCur.name} and restore the GitHub version?`)) return;
  localStorage.removeItem(cvDraftKey(cvCur.name));
  $("cv-editor").value = cvCur.baseText;
  updateCvStatus();
}

function renderAll() { renderPipeline(); renderScout(); renderFirms(); }

/* ---------------- boot ---------------- */

document.querySelectorAll(".tabbtn").forEach((b) =>
  b.onclick = () => switchTab(b.dataset.tab));
$("fab").onclick = () => {
  if (currentTab === "firms") openFirmEdit(null);
  else { sheetPrefillRoleId = null; openEdit(null); }
};
$("ff-save").onclick = saveFirmEdit;
$("ff-delete").onclick = deleteFirmEdit;
$("st-add").onclick = addStatus;
$("st-new").onkeydown = (e) => { if (e.key === "Enter") addStatus(); };
$("st-done").onclick = closeStatusManager;
$("s-statuses").onclick = openStatusManager;
$("s-export-csv").onclick = exportCsv;
$("s-export-json").onclick = exportJson;
$("btn-settings").onclick = openSettings;
$("btn-refresh").onclick = () => { refreshFeed(); syncNow(true); };
$("sheet-backdrop").onclick = closeSheets;
$("f-save").onclick = saveEdit;
$("f-delete").onclick = deleteEdit;
$("s-save").onclick = saveSettings;
$("s-test").onclick = async () => {
  localStorage.setItem("qt.token", $("s-token").value.trim());
  $("s-test-result").textContent = "…";
  const r = await GH.testConnection();
  $("s-test-result").textContent = (r.ok ? "✅ " : "❌ ") + r.msg;
};
$("s-wipe").onclick = () => {
  if (!confirm("Wipe all local data (apps, feed, token)?")) return;
  localStorage.clear();
  location.reload();
};
$("scout-search").oninput = (e) => { scoutSearch = e.target.value; renderScout(); };
$("cv-editor").oninput = cvOnInput;
$("cv-compile").onclick = cvCompile;
$("cv-save").onclick = cvSave;
$("cv-revert").onclick = cvRevert;

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && GH.hasToken()) { syncNow(true); refreshFeed(true); }
});
window.addEventListener("online", () => syncNow(true));

/* service worker + update pill */
if ("serviceWorker" in navigator && !location.search.includes("nosw")) {
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller)
          $("update-pill").classList.remove("hidden");
      });
    });
  });
  $("update-pill").onclick = () => {
    navigator.serviceWorker.getRegistration().then((reg) =>
      reg?.waiting?.postMessage("skipWaiting"));
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
}
$("s-version").textContent = "1.4.0";

renderAll();
switchTab("pipeline");
if (GH.hasToken()) {
  syncNow(true);
  if (!feed) refreshFeed(true);
}
