/* quant-tracker main UI */
"use strict";

/* ---------------- state ---------------- */

const STATUS_ORDER = ["offer", "interview", "oa", "applied", "not_applied", "rejected"];
const STATUS_LABEL = {
  offer: "Offer", interview: "Interview", oa: "OA",
  applied: "Applied", not_applied: "Not applied", rejected: "Rejected",
};
const CAT_LABEL = {
  summer_internship: "INTERN", graduate: "GRAD", spring_week: "SPRING",
  off_cycle: "OFF-CYCLE", other: "OTHER",
};

let apps = loadJSON("qt.apps", []);
let feed = loadJSON("qt.feed", null);          // {lastRun, roles, fetchedAt}
let pipelineFilter = "all";
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

/* ---------------- pipeline tab ---------------- */

function renderPipeline() {
  const live = liveApps();
  const counts = {};
  for (const a of live) counts[a.status] = (counts[a.status] || 0) + 1;

  // summary line
  const active = live.filter((a) => !["rejected", "not_applied"].includes(a.status)).length;
  $("pipeline-summary").innerHTML = live.length
    ? `<b>${live.length}</b> tracked &nbsp;·&nbsp; <b>${active}</b> in play` +
      (counts.interview ? ` &nbsp;·&nbsp; <b>${counts.interview}</b> interview` : "") +
      (counts.oa ? ` &nbsp;·&nbsp; <b>${counts.oa}</b> OA` : "")
    : "";

  // filter chips
  const chips = [["all", `All<span class="n">${live.length}</span>`]];
  for (const s of STATUS_ORDER) {
    if (counts[s]) chips.push([s, `${STATUS_LABEL[s]}<span class="n">${counts[s]}</span>`]);
  }
  $("pipeline-filters").innerHTML = chips.map(([k, html]) =>
    `<button class="chip ${pipelineFilter === k ? "active" : ""}" data-f="${k}">${html}</button>`).join("");
  $("pipeline-filters").querySelectorAll(".chip").forEach((c) =>
    c.onclick = () => { pipelineFilter = c.dataset.f; renderPipeline(); });

  // cards
  const shown = live
    .filter((a) => pipelineFilter === "all" || a.status === pipelineFilter)
    .sort((a, b) => {
      const d = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      return d !== 0 ? d : (b.updated || "").localeCompare(a.updated || "");
    });

  $("apps-list").innerHTML = shown.map((a) => `
    <div class="card s-${a.status} ${a.status === "rejected" ? "dim" : ""}" data-id="${a.id}">
      <div class="card-top">
        <div>
          <div class="card-firm">${esc(a.firm)}</div>
          ${a.role ? `<div class="card-role">${esc(a.role)}</div>` : ""}
        </div>
        <span class="pill ${a.status}">${STATUS_LABEL[a.status]}</span>
      </div>
      ${a.notes ? `<div class="card-sub">✎ ${esc(a.notes.length > 70 ? a.notes.slice(0, 70) + "…" : a.notes)}</div>` : ""}
    </div>`).join("");
  $("apps-list").querySelectorAll(".card").forEach((c) =>
    c.onclick = () => openEdit(c.dataset.id));

  $("pipeline-empty").classList.toggle("hidden", live.length > 0);
}

/* ---------------- edit sheet ---------------- */

function buildStatusPicker(sel) {
  $("f-status").innerHTML = STATUS_ORDER.map((s) =>
    `<button type="button" class="status-opt ${s} ${s === sel ? "sel" : ""}" data-s="${s}">${STATUS_LABEL[s]}</button>`).join("");
  $("f-status").querySelectorAll(".status-opt").forEach((b) =>
    b.onclick = () => buildStatusPicker(b.dataset.s));
}
const pickedStatus = () =>
  $("f-status").querySelector(".sel")?.dataset.s || "not_applied";

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

/* ---------------- sync ---------------- */

function persistApps() {
  saveJSON("qt.apps", apps);
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
    for (let attempt = 0; attempt < 2; attempt++) {
      const { apps: remote, sha } = await GH.loadRemoteApps();
      const merged = GH.mergeApps(apps, remote);
      apps = merged;
      saveJSON("qt.apps", apps);
      if (JSON.stringify(merged) === JSON.stringify(remote)) break;   // nothing to push
      const res = await GH.putRemoteApps(merged, sha);
      if (res.ok) break;
      // conflict: loop once more with fresh sha
    }
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
  for (const id of ["edit-sheet", "settings-sheet", "role-sheet"])
    $(id).classList.add("hidden");
}

const TAB_TITLE = { pipeline: "Pipeline", scout: "Role Scout", cv: "CV Manager" };

function switchTab(name) {
  document.querySelectorAll(".tabbtn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name));
  for (const t of Object.keys(TAB_TITLE))
    $(`tab-${t}`).classList.toggle("hidden", t !== name);
  $("page-title").textContent = TAB_TITLE[name];
  $("fab").classList.toggle("hidden", name !== "pipeline");
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

function renderAll() { renderPipeline(); renderScout(); }

/* ---------------- boot ---------------- */

document.querySelectorAll(".tabbtn").forEach((b) =>
  b.onclick = () => switchTab(b.dataset.tab));
$("fab").onclick = () => { sheetPrefillRoleId = null; openEdit(null); };
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
$("s-version").textContent = "1.1.0";

renderAll();
switchTab("pipeline");
if (GH.hasToken()) {
  syncNow(true);
  if (!feed) refreshFeed(true);
}
