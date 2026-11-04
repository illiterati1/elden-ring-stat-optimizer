export const maxCharacterLevel = 713;

/**
 * @returns the number of runes needed to level up from the given level to the next one
 */
export function getLevelUpCost(level: number) {
  const x = Math.max(0, (level + 81 - 92) * 0.02);
  return Math.floor((x + 0.1) * (level + 81) ** 2 + 1);
}

/**
 * @param ownedLevel levels below this are already owned (e.g. when respeccing), so cost nothing
 * @returns an array where index n is the total number of runes needed to gain n levels starting
 * from the given level
 */
export function getCumulativeLevelUpCosts(
  startLevel: number,
  levels: number,
  ownedLevel = startLevel,
) {
  const costs = [0];
  for (let n = 1; n <= levels; n++) {
    const level = startLevel + n - 1;
    costs.push(costs[n - 1] + (level < ownedLevel ? 0 : getLevelUpCost(level)));
  }
  return costs;
}
