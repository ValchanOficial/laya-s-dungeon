import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAMAGE_PER_LEVEL,
  PHYSICAL_DAMAGE,
  SPELL_DAMAGE,
  applyXp,
  damageRange,
  rollDamage,
  xpFromKill,
  xpToNext,
} from '../src/level.mjs';

describe('xpToNext', () => {
  it('pede 100 XP por nível atual', () => {
    assert.equal(xpToNext(1), 100);
    assert.equal(xpToNext(2), 200);
    assert.equal(xpToNext(5), 500);
  });
});

describe('damageRange', () => {
  it('mantem 12-20 e 26-36 no nivel 1', () => {
    assert.deepEqual(damageRange(PHYSICAL_DAMAGE, 1), { min: 12, max: 20 });
    assert.deepEqual(damageRange(SPELL_DAMAGE, 1), { min: 26, max: 36 });
  });

  it('soma 2 de dano por nivel acima do primeiro', () => {
    assert.deepEqual(damageRange(PHYSICAL_DAMAGE, 3), {
      min: 12 + 2 * DAMAGE_PER_LEVEL,
      max: 20 + 2 * DAMAGE_PER_LEVEL,
    });
    assert.deepEqual(damageRange(SPELL_DAMAGE, 5), {
      min: 26 + 4 * DAMAGE_PER_LEVEL,
      max: 36 + 4 * DAMAGE_PER_LEVEL,
    });
  });

  it('trata nivel ausente ou invalido como 1', () => {
    assert.deepEqual(damageRange(PHYSICAL_DAMAGE), PHYSICAL_DAMAGE);
    assert.deepEqual(damageRange(PHYSICAL_DAMAGE, 0), PHYSICAL_DAMAGE);
    assert.deepEqual(damageRange(PHYSICAL_DAMAGE, Number.NaN), PHYSICAL_DAMAGE);
  });
});

describe('rollDamage', () => {
  it('respeita o intervalo do nivel', () => {
    const range = damageRange(PHYSICAL_DAMAGE, 4);
    assert.equal(rollDamage(PHYSICAL_DAMAGE, 4, () => 0), range.min);
    assert.equal(rollDamage(PHYSICAL_DAMAGE, 4, () => 0.999), range.max);
  });
});

describe('xpFromKill', () => {
  it('soma metade do HP do inimigo com 10 por andar', () => {
    assert.equal(xpFromKill({ floor: 1, enemy: { maxHp: 40 } }), 30);
    assert.equal(xpFromKill({ floor: 4, enemy: { maxHp: 75 } }), 78);
  });
});

describe('applyXp', () => {
  it('acumula XP sem subir de nível', () => {
    assert.deepEqual(
      applyXp({ level: 1, xp: 20, heroHp: 40, heroMana: 10, heroMaxHp: 100, heroMaxMana: 50 }, 30),
      { level: 1, xp: 50, xpNeeded: 100, levelsGained: 0, heroHp: 40, heroMana: 10 },
    );
  });

  it('sobe de nível e enche HP e mana', () => {
    assert.deepEqual(
      applyXp({ level: 1, xp: 80, heroHp: 22, heroMana: 5, heroMaxHp: 100, heroMaxMana: 50 }, 30),
      { level: 2, xp: 10, xpNeeded: 200, levelsGained: 1, heroHp: 100, heroMana: 50 },
    );
  });

  it('pode subir mais de um nível de uma vez', () => {
    const next = applyXp(
      { level: 1, xp: 0, heroHp: 1, heroMana: 0, heroMaxHp: 100, heroMaxMana: 50 },
      350,
    );
    assert.equal(next.level, 3);
    assert.equal(next.levelsGained, 2);
    assert.equal(next.xp, 50);
    assert.equal(next.xpNeeded, 300);
    assert.equal(next.heroHp, 100);
    assert.equal(next.heroMana, 50);
  });
});
