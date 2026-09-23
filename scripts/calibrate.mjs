// Refit de temperatura nos nossos proprios dados, como o model card pede:
// "Ships over-confident ... do this on your own data before trusting the
// probabilities."
//
// Os rotulos de verdade saem das regras do jogo (aritmetica pura), nao de
// opiniao: "perigo mortal" e o proximo golpe matar o heroi, e "finalizar" e o
// inimigo morrer com a melhor acao disponivel neste turno. Ajusta um par
// (a, b) por sinal sobre o logit e grava em calibration.json.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgent } from '../src/laya-agent.mjs';
import { rawSignals, SPELL_COST } from '../src/decision.mjs';
import { PHYSICAL_DAMAGE, SPELL_DAMAGE, damageRange } from '../src/level.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SAMPLES = Number(process.env.SAMPLES ?? 48);

const bestiary = [
  { name: 'Goblin Ladrao', maxHp: 40, attack: 12, intent: 'creeping through the shadows for a quick backstab' },
  { name: 'Esqueleto Guerreiro', maxHp: 60, attack: 18, intent: 'raising a heavy shield and winding up a blunt strike' },
  { name: 'Mago Sombrio', maxHp: 35, attack: 22, intent: 'channelling an unstable arcane fireball' },
  { name: 'Orc Berserker', maxHp: 75, attack: 25, intent: 'roaring with blind rage, winding up a brutal axe swing' },
];

const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

function sampleState() {
  const template = bestiary[randInt(0, bestiary.length - 1)];
  const heroMaxHp = 100;
  // Metade das amostras perto da morte, senao quase nunca ha caso positivo.
  const heroHp = Math.random() < 0.5 ? randInt(1, 35) : randInt(1, heroMaxHp);
  return {
    heroHp,
    heroMaxHp,
    heroMana: randInt(0, 50),
    heroMaxMana: 50,
    potions: randInt(0, 3),
    manaPotions: randInt(0, 2),
    floor: randInt(1, 9),
    level: randInt(1, 6),
    enemy: { ...template, hp: randInt(1, template.maxHp) },
  };
}

// Verdade pelas regras: o minimo de cada acao neste nivel.
const labels = {
  danger: (s) => (s.enemy.attack >= s.heroHp ? 1 : 0),
  finish: (s) => {
    const swing = damageRange(PHYSICAL_DAMAGE, s.level).min;
    const bolt = damageRange(SPELL_DAMAGE, s.level).min;
    return s.enemy.hp <= swing || (s.heroMana >= SPELL_COST && s.enemy.hp <= bolt)
      ? 1
      : 0;
  },
};

const logit = (p) => {
  const c = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return Math.log(c / (1 - c));
};
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

function fit(points) {
  let a = 1;
  let b = 0;
  const lr = 0.05;
  for (let step = 0; step < 4000; step++) {
    let ga = 0;
    let gb = 0;
    for (const { z, y } of points) {
      const err = sigmoid(a * z + b) - y;
      ga += err * z;
      gb += err;
    }
    a -= (lr * ga) / points.length;
    b -= (lr * gb) / points.length;
  }
  return { a: Number(a.toFixed(4)), b: Number(b.toFixed(4)) };
}

function metrics(points, transform) {
  let hits = 0;
  let brier = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const { z, y } of points) {
    const p = transform(z);
    if ((p >= 0.5 ? 1 : 0) === y) hits++;
    brier += (p - y) ** 2;
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.n++;
    bin.p += p;
    bin.y += y;
  }
  const ece = bins
    .filter((bin) => bin.n > 0)
    .reduce((acc, bin) => acc + (bin.n / points.length) * Math.abs(bin.p / bin.n - bin.y / bin.n), 0);
  return {
    accuracy: hits / points.length,
    brier: brier / points.length,
    ece,
  };
}

const SAMPLE_FILE = path.join(ROOT, 'calibration-samples.json');

async function collect() {
  if (process.env.REUSE) {
    const cached = JSON.parse(await readFile(SAMPLE_FILE, 'utf8'));
    console.log(`reusando ${cached.length} amostras de ${SAMPLE_FILE}`);
    return cached;
  }
  const { agent } = await loadAgent(path.join(ROOT, process.env.LAYA_MODEL ?? 'model-en'));
  console.log(`coletando ${SAMPLES} amostras...`);
  const rows = [];
  for (let i = 0; i < SAMPLES; i++) {
    const state = sampleState();
    const raw = await rawSignals(agent, state);
    rows.push({
      danger: { z: logit(raw.danger), y: labels.danger(state) },
      finish: { z: logit(raw.finish), y: labels.finish(state) },
    });
    if ((i + 1) % 8 === 0) process.stdout.write(`  ${i + 1}/${SAMPLES}\n`);
  }
  await writeFile(SAMPLE_FILE, `${JSON.stringify(rows, null, 2)}\n`);
  return rows;
}

const rows = await collect();
const fitted = {};

for (const name of ['danger', 'finish']) {
  const points = rows.map((row) => row[name]);
  const positives = points.reduce((acc, p) => acc + p.y, 0);

  // Numeros honestos: ajusta em 2/3 e mede no terco retido.
  const cut = Math.floor(points.length * (2 / 3));
  const train = points.slice(0, cut);
  const test = points.slice(cut);
  const holdout = fit(train);
  const before = metrics(test, (z) => sigmoid(z));
  const after = metrics(test, (z) => sigmoid(holdout.a * z + holdout.b));

  // So mantem o reajuste se ele melhorar o Brier fora da amostra; um sinal
  // fraco piora quando esticado.
  const keep = after.brier < before.brier;
  if (keep) fitted[name] = fit(points);

  console.log(
    `\n${name}: ${positives}/${points.length} positivos` +
      `\n  retido (${test.length} amostras)` +
      `\n    antes : acc ${before.accuracy.toFixed(3)}  brier ${before.brier.toFixed(3)}  ece ${before.ece.toFixed(3)}` +
      `\n    depois: acc ${after.accuracy.toFixed(3)}  brier ${after.brier.toFixed(3)}  ece ${after.ece.toFixed(3)}` +
      `\n  ${keep ? `aplicado: a=${fitted[name].a} b=${fitted[name].b}` : 'descartado: o reajuste nao melhora fora da amostra, o sinal fica cru'}`,
  );
}

const out = path.join(ROOT, 'calibration.json');
await writeFile(out, `${JSON.stringify({ fittedOn: rows.length, signals: fitted }, null, 2)}\n`);
console.log(`\ngravado em ${out}`);
