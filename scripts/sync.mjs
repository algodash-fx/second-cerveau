// Lit Notion, prépare les jours et séances à venir, puis publie docs/data.enc.json chiffré.
import { writeFileSync } from "node:fs";
import { encrypt } from "./crypto.mjs";

const TOKEN = process.env.NOTION_TOKEN;
const PASSWORD = process.env.DASHBOARD_PASSWORD;
if (!TOKEN || !PASSWORD) throw new Error("NOTION_TOKEN et DASHBOARD_PASSWORD sont requis");

const DB = {
  journal: "1acc5fc9fdb74ef89220a319250375f9",
  seances: "59545c78ab8f4e73b2c3ea156fb7b07a",
  performances: "55ba6c1e79bf4c3ab51a8ea916580803",
  exercices: "1b592aea922d4cf298bf10c1868da975",
  objectifs: "60fa798bf1df4c27b3135b0b78cef335",
  reglages: "0c39c719e6234cae806c70fe1cbcf036",
  habitudes: "107ec2cfe8284df793dce4e3cacd186d",
};
const TIME_ZONE = "Europe/Zurich";
const STREAK_MIN_SCORE = 80;
const JOURS_JOURNAL_AVANCE = 14;
const JOURS_SEANCE_AVANCE = 7;
// getUTCDay : 0 = dimanche
const PROGRAMME_PAR_JOUR = { 3: "Jambes & Dos", 5: "Pectoraux & Triceps", 0: "Épaules & Biceps" };
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

async function notion(path, method = "GET", body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.notion.com/v1/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 1000 * (Number(res.headers.get("retry-after")) || 2)));
      continue;
    }
    if (!res.ok) throw new Error(`Notion ${res.status} sur ${path} : ${await res.text()}`);
    return res.json();
  }
}

async function queryAll(id) {
  const rows = [];
  let cursor;
  do {
    const page = await notion(`databases/${id}/query`, "POST", { page_size: 100, start_cursor: cursor });
    rows.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return rows;
}

const text = (p) => (p?.title ?? p?.rich_text ?? []).map((t) => t.plain_text).join("");
const formula = (p) => p?.formula?.number ?? p?.formula?.boolean ?? null;
const rollup = (p) => p?.rollup?.number ?? null;
const date = (p) => p?.date?.start?.slice(0, 10) ?? null;

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(Date.parse(s) + n * 86400000));
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
const label = (s) => {
  const d = new Date(s);
  return `${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

async function ensureJournal(rows, reglagesId, now) {
  const known = new Set(rows.map((r) => date(r.properties.Date)));
  for (let i = 0; i <= JOURS_JOURNAL_AVANCE; i++) {
    const d = addDays(now, i);
    if (known.has(d)) continue;
    await notion("pages", "POST", {
      parent: { database_id: DB.journal },
      properties: {
        Jour: { title: [{ text: { content: label(d) } }] },
        Date: { date: { start: d } },
        Réglages: { relation: [{ id: reglagesId }] },
      },
    });
  }
}

async function ensureSeances(seances, performances, exercices, now) {
  const dejaPrevues = new Set(
    seances.filter((s) => s.properties.Type.select?.name === "Muscu").map((s) => date(s.properties.Date)),
  );
  const seanceDate = new Map(seances.map((s) => [s.id, date(s.properties.Date)]));
  // Dernière charge saisie sur une ligne cochée Fait, pour chaque exercice
  const derniere = new Map();
  for (const p of performances) {
    const exId = p.properties.Exercice.relation[0]?.id;
    const d = seanceDate.get(p.properties["Séance"].relation[0]?.id);
    const charge = p.properties.Charge.number;
    if (!exId || !d || charge == null || !p.properties.Fait.checkbox) continue;
    if (!derniere.has(exId) || derniere.get(exId).d < d) derniere.set(exId, { d, charge });
  }
  for (let i = 0; i <= JOURS_SEANCE_AVANCE; i++) {
    const d = addDays(now, i);
    const programme = PROGRAMME_PAR_JOUR[new Date(d).getUTCDay()];
    if (!programme || dejaPrevues.has(d)) continue;
    const seance = await notion("pages", "POST", {
      parent: { database_id: DB.seances },
      properties: {
        Séance: { title: [{ text: { content: programme } }] },
        Date: { date: { start: d } },
        Type: { select: { name: "Muscu" } },
      },
    });
    for (const ex of exercices.filter((e) => e.properties.Programme.select?.name === programme)) {
      const charge = derniere.get(ex.id)?.charge ?? ex.properties["Charge cible"].number;
      await notion("pages", "POST", {
        parent: { database_id: DB.performances },
        properties: {
          Ligne: { title: [{ text: { content: text(ex.properties.Exercice) } }] },
          Séance: { relation: [{ id: seance.id }] },
          Exercice: { relation: [{ id: ex.id }] },
          Séries: { number: ex.properties["Séries"].number },
          Reps: { number: ex.properties.Reps.number },
          Charge: { number: charge },
        },
      });
    }
  }
}

function streaks(days, now) {
  let best = 0, run = 0, current = 0;
  const valide = new Set(days.filter((d) => d.score >= STREAK_MIN_SCORE).map((d) => d.date));
  for (const d of days) {
    run = valide.has(d.date) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  // Aujourd'hui ne casse pas la série tant que la journée n'est pas finie
  let cursor = valide.has(now) ? now : addDays(now, -1);
  while (valide.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, best };
}

function buildPayload({ journal, seances, performances, exercices, objectifs, habitudes, schema, now }) {
  // Une habitude suivie porte le même nom que sa colonne du Journal
  const actives = habitudes
    .filter((h) => h.properties.Active.checkbox)
    .map((h) => text(h.properties.Habitude))
    .filter((nom) => schema.properties[nom]?.type === "checkbox");

  const days = journal
    .map((r) => ({
      date: date(r.properties.Date),
      score: formula(r.properties.Score) ?? 0,
      sport: r.properties.Sport.checkbox,
      habits: actives.filter((h) => r.properties[h].checkbox),
    }))
    .filter((d) => d.date && d.date <= now)
    .sort((a, b) => a.date.localeCompare(b.date));

  const exById = new Map(exercices.map((e) => [e.id, e]));
  const seanceById = new Map(seances.map((s) => [s.id, s]));
  const perfs = performances
    .map((p) => {
      const ex = exById.get(p.properties.Exercice.relation[0]?.id);
      const seance = seanceById.get(p.properties["Séance"].relation[0]?.id);
      if (!ex || !seance || !p.properties.Fait.checkbox) return null;
      const series = p.properties["Séries"].number ?? 0;
      const reps = p.properties.Reps.number ?? 0;
      const charge = p.properties.Charge.number ?? 0;
      return {
        date: date(seance.properties.Date),
        exercice: text(ex.properties.Exercice),
        groupe: ex.properties.Groupe.select?.name ?? "Autre",
        charge,
        volume: series * reps * charge * (ex.properties["Par côté"].checkbox ? 2 : 1),
      };
    })
    .filter((p) => p?.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const courses = seances
    .filter((s) => s.properties.Type.select?.name === "Course" && s.properties["Terminée"].checkbox)
    .map((s) => ({
      date: date(s.properties.Date),
      km: s.properties["Distance (km)"].number ?? 0,
      minutes: s.properties["Durée (min)"].number ?? 0,
    }))
    .filter((c) => c.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const goals = objectifs.map((o) => ({
    nom: text(o.properties.Objectif),
    horizon: o.properties.Horizon.select?.name ?? "",
    progression: formula(o.properties.Progression) ?? 0,
  }));

  return {
    updatedAt: new Date().toISOString(),
    today: now,
    habitudes: actives,
    days,
    perfs,
    courses,
    goals,
    seancesFaites: seances.filter((s) => s.properties["Terminée"].checkbox).map((s) => date(s.properties.Date)),
    streak: streaks(days, now),
    streakMinScore: STREAK_MIN_SCORE,
  };
}

const now = today();
const [reglages, schema] = await Promise.all([queryAll(DB.reglages), notion(`databases/${DB.journal}`)]);
const [journalAvant, seancesAvant, perfsAvant, exercices, objectifs, habitudes] = await Promise.all([
  queryAll(DB.journal),
  queryAll(DB.seances),
  queryAll(DB.performances),
  queryAll(DB.exercices),
  queryAll(DB.objectifs),
  queryAll(DB.habitudes),
]);

await ensureJournal(journalAvant, reglages[0].id, now);
await ensureSeances(seancesAvant, perfsAvant, exercices, now);

const payload = buildPayload({
  journal: journalAvant,
  seances: seancesAvant,
  performances: perfsAvant,
  exercices,
  objectifs,
  habitudes,
  schema,
  now,
});
writeFileSync(new URL("../docs/data.enc.json", import.meta.url), JSON.stringify(encrypt(payload, PASSWORD)));
console.log(`${payload.days.length} jours, ${payload.perfs.length} exercices faits`);
