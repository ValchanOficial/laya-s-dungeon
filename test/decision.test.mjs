import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS,
  POTION_HEAL,
  POTION_MANA,
  SPELL_COST,
  applyCalibration,
  decide,
  legalActions,
  loadCalibration,
  setCalibration,
  validateState,
} from '../src/decision.mjs';

const orc = {
  name: 'Orc Berserker',
  hp: 70,
  maxHp: 75,
  attack: 25,
  intent: 'rugindo de raiva',
  intentEn: 'roaring with blind rage, winding up a brutal axe swing',
};

function battle(overrides = {}, enemyOverrides = {}) {
  return {
    heroHp: 80,
    heroMaxHp: 100,
    heroMana: 40,
    heroMaxMana: 50,
    potions: 2,
    manaPotions: 0,
    floor: 3,
    ...overrides,
    enemy: { ...orc, ...enemyOverrides },
  };
}

function mockAgent(signals, { tokens = 210 } = {}) {
  const seen = { state: null, questions: null };
  return {
    seen,
    async predict(state, questions) {
      seen.state = state;
      seen.questions = questions;
      return {
        answers: {
          mortal_danger: { probabilities: { A: signals.danger } },
          finish_it: { probabilities: { A: signals.finish } },
          enemy_threat: { probabilities: { A: signals.threat } },
          aggression: { score: signals.aggression },
        },
        usage: { input_tokens: tokens },
      };
    },
  };
}

const quiet = { danger: 0.1, finish: 0.1, threat: 0.1, aggression: 0 };

afterEach(() => {
  setCalibration({});
});

describe('legalActions', () => {
  it('sempre permite ataque e defesa', () => {
    const legal = legalActions(battle({ heroMana: 0, potions: 0 }));
    assert.equal(legal.attack, true);
    assert.equal(legal.defend, true);
  });

  it('libera magia so com mana suficiente', () => {
    assert.equal(legalActions(battle({ heroMana: SPELL_COST })).spell, true);
    assert.equal(legalActions(battle({ heroMana: SPELL_COST - 1 })).spell, false);
  });

  it('libera pocao so com estoque e heroi ferido', () => {
    assert.equal(legalActions(battle({ heroHp: 99, potions: 1 })).potion, true);
    assert.equal(legalActions(battle({ heroHp: 100, potions: 1 })).potion, false);
    assert.equal(legalActions(battle({ heroHp: 50, potions: 0 })).potion, false);
  });

  it('libera pocao de mana so com estoque e mana incompleta', () => {
    assert.equal(legalActions(battle({ heroMana: 10, manaPotions: 1 })).manaPotion, true);
    assert.equal(legalActions(battle({ heroMana: 50, manaPotions: 1 })).manaPotion, false);
    assert.equal(legalActions(battle({ heroMana: 10, manaPotions: 0 })).manaPotion, false);
  });
});

describe('validateState', () => {
  it('aceita um estado completo', () => {
    assert.equal(validateState(battle()), null);
  });

  it('recusa campos numericos ausentes ou invalidos', () => {
    assert.match(validateState(battle({ heroHp: undefined })), /heroHp/);
    assert.match(validateState(battle({ potions: Number.NaN })), /potions/);
    assert.match(validateState(battle({ floor: Number.POSITIVE_INFINITY })), /floor/);
    assert.match(validateState({}), /heroHp/);
    assert.match(validateState(battle({ manaPotions: Number.NaN })), /manaPotions/);
  });

  it('aceita estado antigo sem manaPotions', () => {
    const state = battle();
    delete state.manaPotions;
    assert.equal(validateState(state), null);
  });

  it('recusa level invalido e aceita ausente', () => {
    assert.match(validateState(battle({ level: Number.NaN })), /level/);
    const state = battle();
    delete state.level;
    assert.equal(validateState(state), null);
  });

  it('recusa inimigo incompleto', () => {
    assert.match(validateState(battle({}, { hp: undefined })), /enemy\.hp/);
    assert.match(validateState(battle({}, { name: 7 })), /enemy\.name/);
  });
});

describe('applyCalibration', () => {
  it('devolve a probabilidade crua sem ajuste', () => {
    setCalibration({});
    assert.equal(applyCalibration('danger', 0.73), 0.73);
  });

  it('reescala o logit com o par (a, b)', () => {
    setCalibration({ danger: { a: 1, b: 0 } });
    assert.ok(Math.abs(applyCalibration('danger', 0.5) - 0.5) < 1e-9);

    setCalibration({ danger: { a: 3.2686, b: -4.388 } });
    const mid = applyCalibration('danger', 0.5);
    assert.ok(mid < 0.02, `0.5 cru deveria cair (foi ${mid})`);
    assert.ok(applyCalibration('danger', 0.95) > mid);
  });

  it('nao explode em 0 ou 1', () => {
    setCalibration({ finish: { a: 2, b: -1 } });
    assert.ok(Number.isFinite(applyCalibration('finish', 0)));
    assert.ok(Number.isFinite(applyCalibration('finish', 1)));
  });
});

describe('loadCalibration', () => {
  it('carrega signals de um calibration.json', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'laya-cal-'));
    await writeFile(
      path.join(dir, 'calibration.json'),
      JSON.stringify({ fittedOn: 4, signals: { finish: { a: 1, b: 0 } } }),
    );
    const raw = await loadCalibration(dir);
    assert.equal(raw.fittedOn, 4);
    assert.ok(Math.abs(applyCalibration('finish', 0.5) - 0.5) < 1e-9);
  });

  it('devolve null se o arquivo nao existe', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'laya-empty-'));
    assert.equal(await loadCalibration(dir), null);
  });
});

describe('decide', () => {
  it('bebe pocao quando o perigo passa do limiar', async () => {
    const d = await decide(mockAgent({ ...quiet, danger: 0.7 }), battle({ heroHp: 12 }));
    assert.equal(d.action, ACTIONS.potion.id);
    assert.equal(d.actionLabel, ACTIONS.potion.label);
    assert.equal(d.driver, 'mortal_danger');
    assert.equal(d.confidence, 0.7);
  });

  it('defende no perigo se nao houver pocao e o bloco salva', async () => {
    const d = await decide(
      mockAgent({ ...quiet, danger: 0.7 }),
      battle({ heroHp: 20, potions: 0 }),
    );
    assert.equal(d.action, ACTIONS.defend.id);
    assert.equal(d.driver, 'mortal_danger');
  });

  it('nao trava em defesa no perigo se o golpe nao mata', async () => {
    const d = await decide(
      mockAgent({ ...quiet, danger: 0.7 }),
      battle({ heroHp: 50, potions: 0 }),
    );
    assert.equal(d.action, ACTIONS.attack.id);
    assert.equal(d.driver, 'default');
  });

  it('ataca no perigo se nem o bloco evita a morte', async () => {
    const d = await decide(
      mockAgent({ ...quiet, danger: 0.9 }),
      battle({ heroHp: 10, potions: 0 }),
    );
    assert.equal(d.action, ACTIONS.attack.id);
    assert.notEqual(d.driver, 'mortal_danger');
  });

  it('abaixa o limiar de perigo quando a agressao sobe', async () => {
    const state = battle({ heroHp: 20 });
    const cautious = await decide(
      mockAgent({ ...quiet, danger: 0.55, aggression: 0 }),
      state,
    );
    const aggressive = await decide(
      mockAgent({ ...quiet, danger: 0.55, aggression: 1 }),
      state,
    );
    assert.equal(cautious.driver, 'default');
    assert.equal(aggressive.driver, 'mortal_danger');
  });

  it('finaliza com a espada se o minimo do nivel basta', async () => {
    const d = await decide(
      mockAgent({ ...quiet, finish: 0.8 }),
      battle({}, { hp: 12 }),
    );
    assert.equal(d.action, ACTIONS.attack.id);
    assert.equal(d.driver, 'finish_it');
  });

  it('finaliza com a espada em HP maior quando o nivel sobe o dano', async () => {
    const d = await decide(
      mockAgent({ ...quiet, finish: 0.8 }),
      battle({ level: 4 }, { hp: 18 }),
    );
    assert.equal(d.action, ACTIONS.attack.id);
    assert.equal(d.driver, 'finish_it');
  });

  it('finaliza com magia se a espada nao mata', async () => {
    const d = await decide(
      mockAgent({ ...quiet, finish: 0.8 }),
      battle({ heroMana: 30 }, { hp: 20 }),
    );
    assert.equal(d.action, ACTIONS.spell.id);
    assert.equal(d.driver, 'finish_it');
  });

  it('finaliza com ataque se nao houver mana para magia', async () => {
    const d = await decide(
      mockAgent({ ...quiet, finish: 0.8 }),
      battle({ heroMana: 10 }, { hp: 20 }),
    );
    assert.equal(d.action, ACTIONS.attack.id);
    assert.equal(d.driver, 'finish_it');
  });

  it('finaliza em vez de defender quando o perigo e alto mas o golpe nao mata', async () => {
    const d = await decide(
      mockAgent({ danger: 0.8, finish: 0.8, threat: 0.95, aggression: 0 }),
      battle({ heroHp: 50, potions: 0 }, { hp: 5 }),
    );
    assert.equal(d.action, ACTIONS.attack.id);
    assert.equal(d.driver, 'finish_it');
  });

  it('prioriza sobreviver mesmo quando da para finalizar', async () => {
    const d = await decide(
      mockAgent({ danger: 0.9, finish: 0.95, threat: 0.2, aggression: 0 }),
      battle({ heroHp: 8, potions: 1 }, { hp: 5 }),
    );
    assert.equal(d.action, ACTIONS.potion.id);
    assert.equal(d.driver, 'mortal_danger');
  });

  it('bloqueia ameaca pesada so se o golpe mata e o bloco salva', async () => {
    const d = await decide(
      mockAgent({ ...quiet, threat: 0.9 }),
      battle({ heroHp: 20, heroMaxHp: 100, potions: 0 }, { attack: 25 }),
    );
    assert.equal(d.action, ACTIONS.defend.id);
    assert.equal(d.driver, 'enemy_threat');
  });

  it('nao bloqueia ameaca so porque o golpe deixaria abaixo de um terco', async () => {
    const d = await decide(
      mockAgent({ ...quiet, threat: 0.9 }),
      battle({ heroHp: 50, heroMaxHp: 100, heroMana: 40 }, { attack: 25 }),
    );
    assert.equal(d.action, ACTIONS.spell.id);
    assert.equal(d.driver, 'enemy_threat');
  });

  it('responde a ameaca pesada com magia se o heroi ainda aguenta o golpe', async () => {
    const d = await decide(
      mockAgent({ ...quiet, threat: 0.9 }),
      battle({ heroHp: 90, heroMana: 40 }, { attack: 20 }),
    );
    assert.equal(d.action, ACTIONS.spell.id);
    assert.equal(d.driver, 'enemy_threat');
  });

  it('bebe pocao de mana na ameaca se nao houver mana para magia', async () => {
    const d = await decide(
      mockAgent({ ...quiet, threat: 0.9 }),
      battle({ heroHp: 90, heroMana: 10, manaPotions: 1 }, { attack: 20 }),
    );
    assert.equal(d.action, ACTIONS.manaPotion.id);
    assert.equal(d.driver, 'enemy_threat');
  });

  it('reabastece mana quando nao consegue lancar magia', async () => {
    const d = await decide(
      mockAgent(quiet),
      battle({ heroMana: 10, manaPotions: 2 }),
    );
    assert.equal(d.action, ACTIONS.manaPotion.id);
    assert.equal(d.driver, 'restore_mana');
  });

  it('cai no ataque fisico no caso padrao', async () => {
    const d = await decide(mockAgent(quiet), battle());
    assert.equal(d.action, ACTIONS.attack.id);
    assert.equal(d.driver, 'default');
    assert.equal(d.confidence, 0.9);
  });

  it('devolve sinais crus e calibrados, legal e metadados', async () => {
    setCalibration({ danger: { a: 1, b: 0 } });
    const agent = mockAgent({ danger: 0.4, finish: 0.2, threat: 0.3, aggression: 1.4 }, {
      tokens: 99,
    });
    const d = await decide(agent, battle());
    assert.equal(d.signals.danger.raw, 0.4);
    assert.ok(Math.abs(d.signals.danger.value - 0.4) < 1e-9);
    assert.equal(d.signals.finish.raw, 0.2);
    assert.equal(d.aggression, 1.4);
    assert.equal(d.aggressionMax, 2);
    assert.equal(d.calibrated, true);
    assert.equal(d.tokens, 99);
    assert.equal(d.legal.spell, true);
    assert.ok(d.latencyMs >= 0);
  });

  it('monta o paragrafo em ingles com as contas ja resolvidas', async () => {
    const agent = mockAgent(quiet);
    await decide(
      agent,
      battle({ heroHp: 12, heroMana: 40, potions: 3, floor: 4 }, { hp: 7, attack: 25 }),
    );
    const paragraph = agent.seen.state;
    assert.match(paragraph, /floor 4/);
    assert.match(paragraph, /almost dead at 12 of 100 hit points/);
    assert.match(paragraph, /almost dead at 7 of 75 hit points/);
    assert.match(paragraph, /drops the hero to 0 hit points/);
    assert.match(paragraph, new RegExp(`enough for ${Math.floor(40 / SPELL_COST)} spells`));
    assert.match(paragraph, new RegExp(`${POTION_HEAL} hit points each`));
    assert.match(paragraph, new RegExp(`0 mana potions worth ${POTION_MANA} mana each`));
    assert.match(paragraph, /roaring with blind rage/);
    assert.doesNotMatch(paragraph, /rugindo/);
  });

  it('usa faixas de vida e o golpe que nao mata', async () => {
    const agent = mockAgent(quiet);
    await decide(agent, battle({ heroHp: 80 }, { hp: 50, attack: 18 }));
    assert.match(agent.seen.state, /unharmed at 80 of 100/);
    assert.match(agent.seen.state, /lightly hurt at 50 of 75/);
    assert.match(agent.seen.state, /drops the hero to 62 hit points/);
  });

  it('faz perguntas binarias com chaves A\/B, nao noul', async () => {
    const agent = mockAgent(quiet);
    await decide(agent, battle());
    const q = agent.seen.questions;
    for (const name of ['mortal_danger', 'finish_it', 'enemy_threat']) {
      assert.equal(q[name].type, 'choice');
      assert.deepEqual(Object.keys(q[name].criteria), ['A', 'B']);
    }
    assert.equal(q.aggression.type, 'score');
    assert.equal(q.aggression.criteria.length, 3);
  });
});
