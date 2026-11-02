// Doit rester identique aux valeurs de scripts/crypto.mjs
const SALT = "second-cerveau-v1";
const ITERATIONS = 250000;
const KEY_STORAGE = "second-cerveau-key";
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

const $ = (id) => document.getElementById(id);
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function readKey() {
  try { return localStorage.getItem(KEY_STORAGE); } catch { return null; }
}
function saveKey(value) {
  try { localStorage.setItem(KEY_STORAGE, value); } catch { /* navigateur sans stockage */ }
}
function forgetKey() {
  try { localStorage.removeItem(KEY_STORAGE); } catch { /* navigateur sans stockage */ }
}

async function deriveKey(password) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(SALT), iterations: ITERATIONS },
    base,
    256,
  );
}

async function decrypt(rawKey, blob) {
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(blob.iv) }, key, bytes(blob.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

const shortDate = (s) => {
  const d = new Date(s);
  return `${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`;
};
const addDays = (s, n) => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);
const weekStart = (s) => addDays(s, -((new Date(s).getUTCDay() + 6) % 7));
const kg = (n) => `${Math.round(n).toLocaleString("fr-CH")} kg`;
const empty = (msg) => `<p class="empty">${msg}</p>`;

function bindTooltips(root) {
  const tip = $("tooltip");
  root.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("pointerenter", () => { tip.textContent = el.dataset.tip; tip.hidden = false; });
    el.addEventListener("pointermove", (e) => {
      tip.style.left = `${Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8)}px`;
      tip.style.top = `${e.clientY - 34}px`;
    });
    el.addEventListener("pointerleave", () => { tip.hidden = true; });
  });
}

function lineChart(points, { min = 0, max, unit = "" } = {}) {
  const W = 480, H = 190, L = 34, R = 10, T = 10, B = 24;
  const top = max ?? (Math.max(...points.map((p) => p.y)) * 1.1 || 1);
  const x = (i) => L + (points.length > 1 ? (i * (W - L - R)) / (points.length - 1) : (W - L - R) / 2);
  const y = (v) => T + (1 - (v - min) / (top - min)) * (H - T - B);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.y).toFixed(1)}`).join("");
  const ticks = [min, (min + top) / 2, top];
  const step = (W - L - R) / Math.max(points.length - 1, 1);
  return `<svg viewBox="0 0 ${W} ${H}" role="img">
    ${ticks.map((t) => `<line class="axis" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${Math.round(t)}</text>`).join("")}
    <path class="line" d="${path}"/>
    ${points.length <= 12 ? points.map((p, i) => `<circle class="dot" cx="${x(i)}" cy="${y(p.y)}" r="4"/>`).join("") : ""}
    <circle class="dot" cx="${x(points.length - 1)}" cy="${y(points.at(-1).y)}" r="4"/>
    <text x="${L}" y="${H - 6}">${shortDate(points[0].x)}</text>
    <text x="${W - R}" y="${H - 6}" text-anchor="end">${shortDate(points.at(-1).x)}</text>
    ${points.map((p, i) => `<rect x="${x(i) - step / 2}" y="${T}" width="${Math.max(step, 12)}" height="${H - T - B}" fill="transparent" data-tip="${shortDate(p.x)} : ${p.y}${unit}"/>`).join("")}
  </svg>`;
}

function barChart(points, unit) {
  const W = 480, H = 170, L = 8, R = 8, T = 8, B = 22, GAP = 4;
  const top = Math.max(...points.map((p) => p.y)) || 1;
  const w = (W - L - R - GAP * (points.length - 1)) / points.length;
  return `<svg viewBox="0 0 ${W} ${H}" role="img">
    <line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>
    ${points.map((p, i) => {
      const h = Math.max((p.y / top) * (H - T - B), 2);
      const bx = L + i * (w + GAP);
      return `<rect class="bar" x="${bx}" y="${H - B - h}" width="${w}" height="${h}" rx="${Math.min(4, w / 2)}" data-tip="Semaine du ${shortDate(p.x)} : ${p.y} ${unit}"/>`;
    }).join("")}
    <text x="${L}" y="${H - 6}">${shortDate(points[0].x)}</text>
    <text x="${W - R}" y="${H - 6}" text-anchor="end">${shortDate(points.at(-1).x)}</text>
  </svg>`;
}

const bars = (rows) => `<div class="rows">${rows.map((r) => `
  <div class="row"><span>${escapeHtml(r.name)}</span><span>${escapeHtml(r.value)}</span>
  <div class="track"><i style="width:${Math.round(r.ratio * 100)}%"></i></div></div>`).join("")}</div>`;

function ring(ratio) {
  const C = 2 * Math.PI * 16;
  return `<svg viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="16" fill="none" stroke="var(--cell-0)" stroke-width="4"/>
    <circle cx="20" cy="20" r="16" fill="none" stroke="var(--mark)" stroke-width="4" stroke-linecap="round"
      stroke-dasharray="${(ratio * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 20 20)"/>
  </svg>`;
}

function renderTiles(d) {
  const day = d.days.find((x) => x.date === d.today);
  const mois = d.today.slice(0, 7);
  const seances = d.seancesFaites.filter((s) => s?.startsWith(mois)).length;
  const km = d.courses.filter((c) => c.date.startsWith(mois)).reduce((n, c) => n + c.km, 0);
  const tile = (label, value, note) => `<div class="tile"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`;
  $("tiles").innerHTML =
    tile("Score du jour", day ? day.score : "–", "sur 100") +
    tile("Série", d.streak.current, `record : ${d.streak.best} j, dès ${d.streakMinScore}/100`) +
    tile("Séances", seances, "ce mois-ci") +
    tile("Course", km.toLocaleString("fr-CH", { maximumFractionDigits: 1 }), "km ce mois-ci");
}

function renderHeatmap(d) {
  const C = 13, G = 3, L = 28, T = 16;
  const scores = new Map(d.days.map((x) => [x.date, x.score]));
  const weeks = 53;
  const first = addDays(weekStart(d.today), -7 * (weeks - 1));
  let cells = "", months = "";
  for (let w = 0; w < weeks; w++) {
    for (let j = 0; j < 7; j++) {
      const date = addDays(first, w * 7 + j);
      if (date > d.today) continue;
      const s = scores.get(date);
      const level = s == null || s === 0 ? 0 : Math.min(4, Math.ceil(s / 25));
      cells += `<rect x="${L + w * (C + G)}" y="${T + j * (C + G)}" width="${C}" height="${C}" rx="3" fill="var(--cell-${level})" data-tip="${shortDate(date)} : ${s ?? "pas de données"}"/>`;
    }
    const start = addDays(first, w * 7);
    if (Number(start.slice(8)) <= 7) {
      months += `<text x="${L + w * (C + G)}" y="10">${MOIS[Number(start.slice(5, 7)) - 1]}</text>`;
    }
  }
  const W = L + weeks * (C + G), H = T + 7 * (C + G);
  const days = ["lun.", "", "mer.", "", "ven.", "", "dim."].map((t, j) => `<text x="0" y="${T + j * (C + G) + 10}">${t}</text>`).join("");
  $("heatmap").innerHTML = `<svg class="heat" viewBox="0 0 ${W} ${H}" role="img" aria-label="Calendrier des scores">${months}${days}${cells}</svg>`;
}

function renderScore(d) {
  const recent = d.days.slice(-30).map((x) => ({ x: x.date, y: x.score }));
  $("score").innerHTML = recent.length > 1
    ? lineChart(recent, { min: 0, max: 100, unit: "/100" })
    : empty("La courbe apparaît après deux jours de suivi.");
}

function renderHabits(d) {
  const recent = d.days.slice(-30);
  if (!recent.length) { $("habits").innerHTML = empty("Coche tes premières habitudes."); return; }
  const rows = d.habitudes.map((h) => {
    const n = recent.filter((x) => x.habits.includes(h)).length;
    return { name: h, value: `${Math.round((100 * n) / recent.length)} %`, ratio: n / recent.length };
  }).sort((a, b) => b.ratio - a.ratio);
  $("habits").innerHTML = bars(rows);
}

function renderProgress(d) {
  const noms = [...new Set(d.perfs.map((p) => p.exercice))].sort((a, b) => a.localeCompare(b, "fr"));
  const select = $("exercise");
  if (!noms.length) {
    select.hidden = true;
    $("progress").innerHTML = empty("Coche Fait sur tes exercices pour voir tes charges évoluer.");
    return;
  }
  select.innerHTML = noms.map((n) => `<option>${escapeHtml(n)}</option>`).join("");
  const draw = () => {
    const points = d.perfs.filter((p) => p.exercice === select.value).map((p) => ({ x: p.date, y: p.charge }));
    $("progress").innerHTML = points.length > 1
      ? lineChart(points, { unit: " kg" })
      : empty(`${points[0].y} kg le ${shortDate(points[0].x)}. La courbe démarre à la prochaine séance.`);
    bindTooltips($("progress"));
  };
  select.addEventListener("change", draw);
  draw();
}

function renderVolume(d) {
  const from = addDays(d.today, -29);
  const totals = new Map();
  for (const p of d.perfs) {
    if (p.date >= from) totals.set(p.groupe, (totals.get(p.groupe) ?? 0) + p.volume);
  }
  const top = Math.max(...totals.values(), 1);
  const rows = [...totals].sort((a, b) => b[1] - a[1]).map(([name, v]) => ({ name, value: kg(v), ratio: v / top }));
  $("volume").innerHTML = rows.length ? bars(rows) : empty("Aucun exercice terminé sur 30 jours.");
}

function renderRunning(d) {
  if (!d.courses.length) { $("running").innerHTML = empty("Ajoute une séance de type Course et coche Terminée."); return; }
  const weeks = new Map();
  for (let i = 11; i >= 0; i--) weeks.set(addDays(weekStart(d.today), -7 * i), 0);
  for (const c of d.courses) {
    const w = weekStart(c.date);
    if (weeks.has(w)) weeks.set(w, weeks.get(w) + c.km);
  }
  $("running").innerHTML = barChart([...weeks].map(([x, y]) => ({ x, y: Math.round(y * 10) / 10 })), "km");
}

function renderRecords(d) {
  const best = new Map();
  for (const p of d.perfs) {
    if (!best.has(p.exercice) || p.charge > best.get(p.exercice).charge) best.set(p.exercice, p);
  }
  const rows = [...best.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  $("records").innerHTML = rows.length
    ? `<div class="rows">${rows.map((r) => `<div class="row"><span>${escapeHtml(r.exercice)}</span><span>${r.charge} kg · ${shortDate(r.date)}</span></div>`).join("")}</div>`
    : empty("Tes records apparaîtront ici.");
}

function renderGoals(d) {
  $("goals").innerHTML = d.goals.length
    ? d.goals.map((g) => `<div class="goal">${ring(g.progression)}<div><b>${escapeHtml(g.nom)}</b><small>${escapeHtml(g.horizon)} · ${Math.round(g.progression * 100)} %</small></div></div>`).join("")
    : empty("Ajoute ton premier objectif dans Notion.");
}

function render(d) {
  renderTiles(d);
  renderHeatmap(d);
  renderScore(d);
  renderHabits(d);
  renderProgress(d);
  renderVolume(d);
  renderRunning(d);
  renderRecords(d);
  renderGoals(d);
  $("updated").textContent = `Mis à jour le ${new Date(d.updatedAt).toLocaleString("fr-CH", { dateStyle: "long", timeStyle: "short" })}`;
  $("lock").hidden = true;
  $("app").hidden = false;
  $("heatmap").scrollLeft = $("heatmap").scrollWidth;
  bindTooltips($("app"));
}

async function start() {
  const blob = await fetch(`data.enc.json?t=${Date.now()}`).then((r) => r.json());
  const saved = readKey();
  if (saved) {
    try {
      render(await decrypt(bytes(saved), blob));
      return;
    } catch {
      forgetKey();
    }
  }
  $("lock").hidden = false;
  $("lock").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const raw = await deriveKey($("password").value);
      const data = await decrypt(raw, blob);
      saveKey(b64(raw));
      render(data);
    } catch {
      $("error").textContent = "Mot de passe incorrect.";
    }
  });
}

start().catch(() => {
  $("lock").hidden = false;
  $("error").textContent = "Données indisponibles pour le moment.";
});
