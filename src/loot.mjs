// Queda de itens ao derrotar um inimigo. Puro e sem I/O — o cliente aplica
// o resultado no inventario; os testes injetam o RNG.

export const DROP = {
  heal: { type: 'heal', chance: 0.45, label: 'Poção de Cura' },
  mana: { type: 'mana', chance: 0.4, label: 'Poção de Mana' },
};

export function floorBonus(floor) {
  return Math.min(0.2, Math.max(0, (Number(floor) || 1) - 1) * 0.03);
}

export function rollLoot({ floor = 1, enemy = {} } = {}, rng = Math.random) {
  const bonus = floorBonus(floor);
  const rates = enemy.loot ?? {};
  const drops = [];
  if (rng() < (rates.heal ?? DROP.heal.chance) + bonus) {
    drops.push({ type: DROP.heal.type, qty: 1, label: DROP.heal.label });
  }
  if (rng() < (rates.mana ?? DROP.mana.chance) + bonus) {
    drops.push({ type: DROP.mana.type, qty: 1, label: DROP.mana.label });
  }
  return drops;
}

export function applyLoot(inventory, drops) {
  const next = {
    potions: inventory.potions ?? 0,
    manaPotions: inventory.manaPotions ?? 0,
  };
  for (const drop of drops) {
    const qty = drop.qty ?? 1;
    if (drop.type === 'heal') next.potions += qty;
    if (drop.type === 'mana') next.manaPotions += qty;
  }
  return next;
}
