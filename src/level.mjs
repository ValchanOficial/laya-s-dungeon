// Progressão do cavaleiro. Puro e sem I/O — o cliente aplica o resultado
// no estado do herói; os testes cobrem a curva, o dano e o refill no level up.

export const PHYSICAL_DAMAGE = { min: 12, max: 20 };
export const SPELL_DAMAGE = { min: 26, max: 36 };
export const DAMAGE_PER_LEVEL = 2;

export function heroLevel(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function xpToNext(level) {
  return 100 * heroLevel(level);
}

export function damageRange(base, level) {
  const bonus = DAMAGE_PER_LEVEL * (heroLevel(level) - 1);
  return { min: base.min + bonus, max: base.max + bonus };
}

export function rollDamage(base, level, rng = Math.random) {
  const { min, max } = damageRange(base, level);
  return min + Math.floor(rng() * (max - min + 1));
}

export function xpFromKill({ floor = 1, enemy = {} } = {}) {
  const body = Number(enemy.maxHp) || 40;
  const depth = Math.max(1, Number(floor) || 1);
  return Math.round(body / 2) + 10 * depth;
}

export function applyXp(hero, gained) {
  let level = hero.level ?? 1;
  let xp = (hero.xp ?? 0) + Math.max(0, Number(gained) || 0);
  let levelsGained = 0;
  let needed = xpToNext(level);
  while (xp >= needed) {
    xp -= needed;
    level += 1;
    levelsGained += 1;
    needed = xpToNext(level);
  }

  const next = {
    level,
    xp,
    xpNeeded: needed,
    levelsGained,
    heroHp: hero.heroHp,
    heroMana: hero.heroMana,
  };
  if (levelsGained > 0) {
    next.heroHp = hero.heroMaxHp;
    next.heroMana = hero.heroMaxMana;
  }
  return next;
}
