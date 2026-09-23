// Traduz o estado da batalha em perguntas tipadas para o Laya e funde as
// respostas em uma jogada.
//
// O formato segue os "Honest Limits" do model card e o exemplo oficial
// snake.mjs do laya-ts:
//   - perguntas binarias com chaves neutras A/B em vez de 'noul', que nesta
//     familia tende a seguir os rotulos false:/true: em vez do estado;
//   - o modelo estima probabilidades calibradas, e a politica do jogo combina
//     esses sinais com as regras (mana, pocoes) para escolher a acao;
//   - o estado ja chega com as comparacoes aritmeticas resolvidas, porque o
//     encoder le texto bem e compara numeros mal.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PHYSICAL_DAMAGE, damageRange } from './level.mjs';

export const SPELL_COST = 15;
export const POTION_HEAL = 40;
export const POTION_MANA = 25;

export const ACTIONS = {
  attack: { id: 'atacar_fisico', label: 'Ataque Fisico' },
  spell: { id: 'usar_magia', label: 'Magia Arcana' },
  potion: { id: 'curar', label: 'Pocao de Cura' },
  manaPotion: { id: 'usar_pocao_mana', label: 'Pocao de Mana' },
  defend: { id: 'defender', label: 'Postura Defensiva' },
};

export function legalActions(state) {
  const legal = { attack: true, defend: true };
  legal.spell = state.heroMana >= SPELL_COST;
  legal.potion = state.potions > 0 && state.heroHp < state.heroMaxHp;
  legal.manaPotion = (state.manaPotions ?? 0) > 0 && state.heroMana < state.heroMaxMana;
  return legal;
}

export function validateState(state) {
  const numbers = ['heroHp', 'heroMaxHp', 'heroMana', 'heroMaxMana', 'potions', 'floor'];
  for (const key of numbers) {
    if (!Number.isFinite(state?.[key])) return `campo '${key}' ausente ou invalido`;
  }
  if (state?.manaPotions !== undefined && !Number.isFinite(state.manaPotions)) {
    return "campo 'manaPotions' invalido";
  }
  if (state?.level !== undefined && !Number.isFinite(state.level)) {
    return "campo 'level' invalido";
  }
  for (const key of ['hp', 'maxHp', 'attack']) {
    if (!Number.isFinite(state?.enemy?.[key])) return `campo 'enemy.${key}' ausente ou invalido`;
  }
  if (typeof state.enemy.name !== 'string') return "campo 'enemy.name' ausente";
  return null;
}

// Texto do estado: numeros crus mais as comparacoes que o modelo nao faz
// sozinho. Nenhuma frase diz o que fazer — isso e o que o Laya decide.
function tier(value, max, words) {
  const ratio = value / Math.max(1, max);
  if (ratio <= 0.15) return words[0];
  if (ratio <= 0.4) return words[1];
  if (ratio <= 0.75) return words[2];
  return words[3];
}

function battleState(state) {
  const { heroHp, heroMaxHp, heroMana, heroMaxMana, potions, enemy } = state;
  const manaPotions = state.manaPotions ?? 0;
  const afterHit = heroHp - enemy.attack;

  return [
    `A hero is fighting a ${enemy.name} on floor ${state.floor} of a dungeon.`,
    `The hero is ${tier(heroHp, heroMaxHp, ['almost dead', 'badly hurt', 'lightly hurt', 'unharmed'])} at ${heroHp} of ${heroMaxHp} hit points.`,
    `The ${enemy.name} is ${tier(enemy.hp, enemy.maxHp, ['almost dead', 'badly hurt', 'lightly hurt', 'unharmed'])} at ${enemy.hp} of ${enemy.maxHp} hit points.`,
    afterHit <= 0
      ? `The ${enemy.name} hits for ${enemy.attack}, which drops the hero to 0 hit points.`
      : `The ${enemy.name} hits for ${enemy.attack}, which drops the hero to ${afterHit} hit points.`,
    `The hero holds ${heroMana} of ${heroMaxMana} mana, enough for ${Math.floor(heroMana / SPELL_COST)} spells, ${potions} healing potions worth ${POTION_HEAL} hit points each, and ${manaPotions} mana potions worth ${POTION_MANA} mana each.`,
    // A interface fala portugues; o checkpoint da raiz e o ingles.
    `The ${enemy.name} is ${enemy.intentEn ?? enemy.intent}.`,
  ].join(' ');
}

function buildQuestions() {
  return {
    mortal_danger: {
      type: 'choice',
      instructions:
        'Is the hero in mortal danger, so that surviving this turn matters more than dealing damage?',
      criteria: {
        A: 'yes, the hero is about to die and must protect himself now',
        B: 'no, the hero can afford to keep fighting',
      },
    },
    finish_it: {
      type: 'choice',
      instructions: 'Is the enemy weak enough to be killed this very turn?',
      criteria: {
        A: 'yes, the enemy has almost no hit points left',
        B: 'no, the enemy still has a lot of hit points',
      },
    },
    enemy_threat: {
      type: 'choice',
      instructions:
        'Is the enemy winding up a devastating blow that the hero should brace for?',
      criteria: {
        A: 'yes, what the enemy is doing looks heavy and destructive',
        B: 'no, what the enemy is doing looks minor or careless',
      },
    },
    aggression: {
      type: 'score',
      instructions: 'How aggressively should the hero play this turn?',
      criteria: [
        'play it safe, surviving matters more than damage',
        'trade blows evenly',
        'go all out for the kill',
      ],
    },
  };
}

// Probabilidades cruas deste checkpoint: uteis como ordenacao, largas demais
// como probabilidade. Um par (a, b) por sinal reescala o logit; sem arquivo de
// calibracao o valor passa intacto. Ver scripts/calibrate.mjs.
let calibration = {};

export function setCalibration(fitted) {
  calibration = fitted ?? {};
}

export async function loadCalibration(dir) {
  try {
    const raw = JSON.parse(
      await readFile(path.join(dir, 'calibration.json'), 'utf8'),
    );
    setCalibration(raw.signals);
    return raw;
  } catch {
    return null;
  }
}

export function applyCalibration(name, p) {
  const fit = calibration[name];
  if (!fit) return p;
  const clamped = Math.min(1 - 1e-6, Math.max(1e-6, p));
  const logit = Math.log(clamped / (1 - clamped));
  return 1 / (1 + Math.exp(-(fit.a * logit + fit.b)));
}

export async function rawSignals(agent, state) {
  const started = process.hrtime.bigint();
  const result = await agent.predict(battleState(state), buildQuestions());
  const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
  const a = result.answers;
  return {
    danger: a.mortal_danger.probabilities.A,
    finish: a.finish_it.probabilities.A,
    threat: a.enemy_threat.probabilities.A,
    aggression: a.aggression.score,
    latencyMs: Math.round(latencyMs),
    tokens: result.usage.input_tokens,
  };
}

// O heroi age primeiro; o inimigo revida no mesmo turno. Defender divide o
// golpe pela metade. So vale a pena se o golpe sem escudo mata e o bloco
// ainda deixa o heroi em pe — senão a postura vira loop: vida baixa, sinais
// altos, defesa, chip, e o heroi nunca mais ataca.
function blockWouldSave(state) {
  const hit = Math.max(0, Number(state.enemy?.attack) || 0);
  return state.heroHp - hit <= 0 && state.heroHp - Math.floor(hit / 2) > 0;
}

// Funde os sinais calibrados com as regras do jogo.
function chooseAction(signals, legal, state) {
  const { danger, finish, threat, aggression } = signals;
  // Quanto mais agressivo o turno, mais risco o heroi tolera antes de recuar.
  const dangerLimit = 0.6 - 0.1 * aggression;
  const canBlock = blockWouldSave(state);

  if (danger >= dangerLimit && legal.potion) {
    return { action: 'potion', driver: 'mortal_danger', confidence: danger };
  }
  if (danger >= dangerLimit && canBlock) {
    return { action: 'defend', driver: 'mortal_danger', confidence: danger };
  }
  if (finish >= 0.5) {
    // Se a espada ja basta para matar, nao gasta mana.
    const swingMin = damageRange(PHYSICAL_DAMAGE, state.level).min;
    const action = state.enemy.hp <= swingMin || !legal.spell ? 'attack' : 'spell';
    return { action, driver: 'finish_it', confidence: finish };
  }
  if (threat >= 0.9 && canBlock) {
    return { action: 'defend', driver: 'enemy_threat', confidence: threat };
  }
  if (threat >= 0.9 && legal.spell) {
    return { action: 'spell', driver: 'enemy_threat', confidence: threat };
  }
  if (threat >= 0.9 && legal.manaPotion) {
    return { action: 'manaPotion', driver: 'enemy_threat', confidence: threat };
  }
  // Sem mana para magia, reabastece em vez de so socar.
  if (!legal.spell && legal.manaPotion) {
    return { action: 'manaPotion', driver: 'restore_mana', confidence: 1 - danger };
  }
  return { action: 'attack', driver: 'default', confidence: 1 - danger };
}

export async function decide(agent, state) {
  const raw = await rawSignals(agent, state);
  const signals = {
    danger: applyCalibration('danger', raw.danger),
    finish: applyCalibration('finish', raw.finish),
    threat: applyCalibration('threat', raw.threat),
    aggression: raw.aggression,
  };

  const legal = legalActions(state);
  const chosen = chooseAction(signals, legal, state);

  return {
    action: ACTIONS[chosen.action].id,
    actionLabel: ACTIONS[chosen.action].label,
    driver: chosen.driver,
    confidence: chosen.confidence,
    signals: {
      danger: { value: signals.danger, raw: raw.danger },
      finish: { value: signals.finish, raw: raw.finish },
      threat: { value: signals.threat, raw: raw.threat },
    },
    calibrated: Object.keys(calibration).length > 0,
    aggression: raw.aggression,
    aggressionMax: 2,
    legal,
    latencyMs: raw.latencyMs,
    tokens: raw.tokens,
  };
}
