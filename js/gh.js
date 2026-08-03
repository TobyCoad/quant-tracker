/* GitHub API layer: private-repo scout feed + application sync.
 *
 * All data lives in TobyCoad/quant-role-scout (private):
 *   data/seen.json            – scout's full role corpus (read)
 *   data/last_run.json        – daily run stamp (read)
 *   tracker/applications.json – this app's pipeline (read/write)
 *   tracker/firms.json        – firm watchlist (read/write)
 *   tracker/cv/*.tex          – CV sources (read/write)
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
    if (r.status === 401 || r.status === 403) throw new Error(`auth ${r.status}`);
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

  /* ---------- synced JSON lists (applications, firms) ---------- */

  function makeListStore(path, key, message) {
    return {
      async load() {
        const res = await apiGet(path);
        if (!res) return { list: [], sha: null };
        return { list: res.json[key] || [], sha: res.sha };
      },
      async put(list, sha) {
        if (MOCK) return { ok: true, mock: true };
        const content = encodeB64(JSON.stringify(
          { version: 1, updated: new Date().toISOString(), [key]: list }, null, 1));
        const body = { message, content, branch: "main" };
        if (sha) body.sha = sha;
        const r = await fetch(API + path, {
          method: "PUT", headers: headers(), body: JSON.stringify(body),
        });
        if (r.status === 409 || r.status === 422) return { ok: false, conflict: true };
        if (!r.ok) throw new Error(`GitHub PUT ${r.status}`);
        return { ok: true };
      },
    };
  }

  const appsStore = makeListStore(APPS_PATH, "apps", "tracker: update pipeline");
  const firmsStore = makeListStore("tracker/firms.json", "firms", "tracker: update firm watchlist");

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

  /* ---------- CV manager (tracker/cv/*.tex in the private repo) ---------- */

  async function listCv() {
    if (MOCK) return (await (await fetch("dev-mock/cvlist.json", { cache: "no-store" })).json());
    const r = await fetch(API + "tracker/cv?ref=main", { headers: headers(), cache: "no-store" });
    if (r.status === 404) return [];
    if (r.status === 401 || r.status === 403) throw new Error(`auth ${r.status}`);
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    return (await r.json()).filter((f) => f.name.endsWith(".tex")).map((f) => ({ name: f.name }));
  }

  async function loadCvFile(name) {
    if (MOCK) {
      const r = await fetch(`dev-mock/${name}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`mock ${name}`);
      return { text: await r.text(), sha: "mock" };
    }
    const r = await fetch(API + `tracker/cv/${name}?ref=main&t=${Date.now()}`, {
      headers: headers(), cache: "no-store",
    });
    if (r.status === 401 || r.status === 403) throw new Error(`auth ${r.status}`);
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const body = await r.json();
    return { text: decodeB64(body.content), sha: body.sha };
  }

  async function saveCvFile(name, text, sha) {
    if (MOCK) return { ok: true, sha: "mock" };
    const body = {
      message: `tracker: update ${name}`,
      content: encodeB64(text), branch: "main",
    };
    if (sha) body.sha = sha;
    const r = await fetch(API + `tracker/cv/${name}`, {
      method: "PUT", headers: headers(), body: JSON.stringify(body),
    });
    if (r.status === 409 || r.status === 422) return { ok: false, conflict: true };
    if (!r.ok) throw new Error(`GitHub PUT ${r.status}`);
    return { ok: true, sha: (await r.json()).content.sha };
  }

  async function testConnection() {
    if (MOCK) return { ok: true, msg: "mock mode" };
    if (!token()) return { ok: false, msg: "No token saved" };
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}`, { headers: headers() });
      if (r.status === 401) return { ok: false, msg: "Token rejected (401)" };
      if (r.status === 404) return { ok: false, msg: "Repo not visible — select quant-role-scout on the token" };
      if (!r.ok) return { ok: false, msg: `GitHub error ${r.status}` };
      // repo metadata isn't enough: actually exercise the Contents permission,
      // which fine-grained tokens don't include by default
      const c = await fetch(API + "data/last_run.json", {
        headers: headers("application/vnd.github.raw+json"), cache: "no-store",
      });
      if (c.status === 401 || c.status === 403 || c.status === 404)
        return { ok: false, msg: `Contents blocked (${c.status}) — token needs Contents: Read and write` };
      if (!c.ok) return { ok: false, msg: `Contents error ${c.status}` };
      const run = await c.json();
      return { ok: true, msg: `Connected ✓ — scout last ran ${run.date}` };
    } catch {
      return { ok: false, msg: "Network error" };
    }
  }

  return { fetchFeed, appsStore, firmsStore, mergeApps, testConnection,
           listCv, loadCvFile, saveCvFile,
           hasToken: () => MOCK || !!token(), MOCK };
})();
