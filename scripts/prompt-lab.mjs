// Testa se o modelo separa as intencoes de cada inimigo (tarefa de texto, onde
// o encoder e forte). Uso: node scripts/prompt-lab.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgent } from '../src/laya-agent.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { agent } = await loadAgent(path.join(ROOT, process.env.LAYA_MODEL ?? 'model-en'));

const intents = [
  ['Goblin', 'creeping through the shadows for a quick backstab'],
  ['Esqueleto', 'raising a heavy shield and winding up a blunt strike'],
  ['Mago', 'channelling an unstable arcane fireball'],
  ['Orc', 'roaring with blind rage, winding up a brutal axe swing'],
  ['Rato', 'sniffing around the floor, barely paying attention to the hero'],
  ['Dragao', 'inhaling deeply, about to breathe a torrent of fire over the whole room'],
];

const question = {
  enemy_threat: {
    type: 'choice',
    instructions: 'Is the enemy winding up a devastating blow that the hero should brace for?',
    criteria: {
      A: 'yes, what the enemy is doing looks heavy and destructive',
      B: 'no, what the enemy is doing looks minor or careless',
    },
  },
};

for (const [name, intent] of intents) {
  const state = `A hero is fighting a monster in a dungeon. The monster is ${intent}.`;
  const out = await agent.predict(state, question);
  const p = out.answers.enemy_threat.probabilities.A;
  console.log(`${name.padEnd(10)} ameaca ${(p * 100).toFixed(0).padStart(3)}%  "${intent.slice(0, 50)}"`);
}
