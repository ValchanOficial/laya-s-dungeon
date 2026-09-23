// Roda situacoes de batalha pelo modelo e imprime os sinais e a jogada.
// Uso: node scripts/smoke.mjs   (LAYA_MODEL=model-en por padrao)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgent } from '../src/laya-agent.mjs';
import { decide, loadCalibration } from '../src/decision.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const orc = {
  name: 'Orc Berserker',
  hp: 70,
  maxHp: 75,
  attack: 25,
  intent: 'roaring with blind rage, winding up a brutal axe swing',
};
const base = { heroMaxHp: 100, heroMaxMana: 50, manaPotions: 1, floor: 4, enemy: orc };

const cenarios = [
  ['prestes a morrer, com pocoes', { ...base, heroHp: 12, heroMana: 40, potions: 3 }],
  ['prestes a morrer, sem pocoes', { ...base, heroHp: 12, heroMana: 40, potions: 0 }],
  ['ferido pela metade', { ...base, heroHp: 50, heroMana: 30, potions: 2 }],
  ['inteiro, mana cheia', { ...base, heroHp: 98, heroMana: 50, potions: 3 }],
  ['inimigo quase morto', { ...base, heroHp: 70, heroMana: 50, potions: 2, enemy: { ...orc, hp: 7 } }],
  ['inimigo quase morto, heroi na corda bamba', { ...base, heroHp: 10, heroMana: 50, potions: 1, enemy: { ...orc, hp: 7 } }],
];

const started = Date.now();
const { agent, cfg } = await loadAgent(path.join(ROOT, process.env.LAYA_MODEL ?? 'model-en'));
const calibration = await loadCalibration(ROOT);
console.log(
  `checkpoint carregado em ${Date.now() - started} ms (max_len ${cfg.max_len}), ` +
    `calibracao: ${calibration ? Object.keys(calibration.signals).join(', ') : 'nenhuma'}\n`,
);

const pct = (v) => `${(v * 100).toFixed(0)}%`.padStart(4);

for (const [nome, cenario] of cenarios) {
  const d = await decide(agent, cenario);
  console.log(
    `${nome.padEnd(42)} hp ${String(cenario.heroHp).padStart(3)} | perigo ${pct(d.signals.danger.value)} finalizar ${pct(d.signals.finish.value)} ameaca ${pct(d.signals.threat.value)} agressao ${d.aggression.toFixed(2)} -> ${d.actionLabel} (${d.driver}, ${d.latencyMs} ms)`,
  );
}
