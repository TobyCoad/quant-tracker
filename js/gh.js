/* GitHub API layer: private-repo scout feed + application sync.
 *
 * All data lives in TobyCoad/quant-role-scout (private):
 *   data/seen.json            – scout's full role corpus (read)
 *   data/last_run.json        – daily run stamp (read)
 *   tracker/applications.json – this app's pipeline (read/write)
 *
 * With ?mock=1 the app reads local dev-mock/ files instead (dev only).
 */
"use strict";

const GH = (() => {
  const REPO = "TobyCoad/quant-role-scout";
  const APPS_PATH = "tracker/applications.json";
  const API = `https://api.github.com/repos/${REPO}/contents/`;
  const MOCK = new URLSearchParams(location.search).has("mock");

  const token = () => localStorage.getItem("qt.token") || "";

  function headers(accept) {
    return {
      Authorization: `Bearer ${token()}`,
      Accept: accept || "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  async function apiGet(path, raw) {
    if (MOCK) {
      const r = await fetch(`dev-mock/${path.split("/").pop()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`mock ${path}: ${r.status}`);
      return raw ? r.json() : { content: null, json: await r.json(), sha: "mock" };
    }
    const r = await fetch(API + path + `?ref=main&t=${Date.now()}`, {
      headers: headers(raw ? "application/vnd.github.raw+json" : undefined),
      cache: "no-store",
    });
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) throw new Error("auth");
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    if (raw) return r.json();
    const body = await r.json();
    return { json: JSON.parse(decodeB64(body.content)), sha: body.sha };
  }

  // UTF-8-safe base64
  function decodeB64(b64) {
    const bin = atob(b64.replace(/\n/g, ""));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  function encodeB64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  /* ---------- scout feed ---------- */

  function slimRole(id, r) {
    const t = (r.scores && r.scores.toby) || {};
    return {
      id,
      title: r.title,
      company: r.company,
      location: r.location,
      url: r.url,
      category: r.category,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      fit: typeof t.fit_score === "number" ? t.fit_score : null,
      one_line: t.one_line || "",
      season_fit: t.season_fit || "",
      best_cv: t.best_cv || "",
      reasons: t.reasons || [],
      red_flags: t.red_flags || [],
      desc: (r.description || "")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
        .replace(/[ \t]+\n/g, "\n").slice(0, 600),
    };
  }

  async function fetchFeed() {
    const [lastRun, seen] = await Promise.all([
      apiGet("data/last_run.json", true),
      apiGet("data/seen.json", true),
    ]);
    const roles = Object.entries(seen)
      .map(([id, r]) => slimRole(id, r))
      .sort((a, b) =>
        b.first_seen === a.first_seen
          ? (b.fit || 0) - (a.fit || 0)
          : b.first_seen.localeCompare(a.first_seen));
    return { lastRun, roles, fetchedAt: new Date().toISOString() };
  }

  /* ---------- applications sync ---------- */

  async function loadRemoteApps() {
    const res = await apiGet(APPS_PATH);
    if (!res) return { apps: [], sha: null };
    return { apps: res.json.apps || [], sha: res.sha };
  }

  async function putRemoteApps(apps, sha, message) {
    if (MOCK) return { ok: true, mock: true };
    const content = encodeB64(
      JSON.stringify({ version: 1, updated: new Date().toISOString(), apps }, null, 1));
    const body = { message: message || "tracker: update pipeline", content, branch: "main" };
    if (sha) body.sha = sha;
    const r = await fetch(API + APPS_PATH, {
      method: "PUT", headers: headers(), body: JSON.stringify(body),
    });
    if (r.status === 409 || r.status === 422) return { ok: false, conflict: true };
    if (!r.ok) throw new Error(`GitHub PUT ${r.status}`);
    return { ok: true };
  }

  // Per-app merge: later `updated` wins; tombstones (deleted:true) respected.
  function mergeApps(local, remote) {
    const byId = new Map();
    for (const a of remote) byId.set(a.id, a);
    for (const a of local) {
      const r = byId.get(a.id);
      if (!r || (a.updated || "") >= (r.updated || "")) byId.set(a.id, a);
    }
    return [...byId.values()].filter(
      (a) => !(a.deleted && a.updated < daysAgoIso(90)));
  }

  function daysAgoIso(n) {
    return new Date(Date.now() - n * 864e5).toISOString();
  }

  async function testConnection() {
    if (MOCK) return { ok: true, msg: "mock mode" };
    if (!token()) return { ok: false, msg: "No token saved" };
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}`, { headers: headers() });
      if (r.status === 401) return { ok: false, msg: "Token rejected (401)" };
      if (r.status === 404) return { ok: false, msg: "Repo not visible — check token scope" };
      if (!r.ok) return { ok: false, msg: `GitHub error ${r.status}` };
      const push = (await r.json()).permissions?.push;
      return { ok: true, msg: push ? "Connected — read + write ✓" : "Read-only token (sync disabled)" };
    } catch {
      return { ok: false, msg: "Network error" };
    }
  }

  return { fetchFeed, loadRemoteApps, putRemoteApps, mergeApps, testConnection,
           hasToken: () => MOCK || !!token(), MOCK };
})();
