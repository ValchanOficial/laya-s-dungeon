import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyLoot, floorBonus, rollLoot } from '../src/loot.mjs';

function seq(values) {
  let i = 0;
  return () => values[i++];
}

describe('floorBonus', () => {
  it('comeca em zero no primeiro andar', () => {
    assert.equal(floorBonus(1), 0);
  });

  it('sobe 3 pontos percentuais por andar e trava em 20', () => {
    assert.ok(Math.abs(floorBonus(2) - 0.03) < 1e-9);
    assert.ok(Math.abs(floorBonus(8) - 0.2) < 1e-9);
    assert.equal(floorBonus(20), 0.2);
  });
});

describe('rollLoot', () => {
  it('pode cair so cura, so mana, os dois ou nada', () => {
    assert.deepEqual(
      rollLoot({ floor: 1 }, seq([0.1, 0.99])).map((d) => d.type),
      ['heal'],
    );
    assert.deepEqual(
      rollLoot({ floor: 1 }, seq([0.99, 0.1])).map((d) => d.type),
      ['mana'],
    );
    assert.deepEqual(
      rollLoot({ floor: 1 }, seq([0.1, 0.1])).map((d) => d.type),
      ['heal', 'mana'],
    );
    assert.deepEqual(rollLoot({ floor: 1 }, seq([0.99, 0.99])), []);
  });

  it('usa a tabela do inimigo quando existe', () => {
    const drops = rollLoot(
      { floor: 1, enemy: { loot: { heal: 0, mana: 1 } } },
      seq([0.5, 0.5]),
    );
    assert.deepEqual(drops.map((d) => d.type), ['mana']);
  });

  it('o andar aumenta a chance padrao', () => {
    const drops = rollLoot({ floor: 8 }, seq([0.5, 0.5]));
    assert.deepEqual(drops.map((d) => d.type), ['heal', 'mana']);
  });
});

describe('applyLoot', () => {
  it('soma as pocoes ao inventario', () => {
    assert.deepEqual(
      applyLoot(
        { potions: 2, manaPotions: 1 },
        [
          { type: 'heal', qty: 1 },
          { type: 'mana', qty: 1 },
        ],
      ),
      { potions: 3, manaPotions: 2 },
    );
  });

  it('nao altera o inventario sem drops', () => {
    assert.deepEqual(applyLoot({ potions: 1, manaPotions: 0 }, []), {
      potions: 1,
      manaPotions: 0,
    });
  });
});
