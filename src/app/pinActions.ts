import type { BuildRequest } from "../optimizer/build.ts";
import {
  getFrozenKey,
  getKeyOfPin,
  getPinChartKey,
  storeRequest,
  type Pin,
  type PinSettings,
} from "./pins.ts";
import { defaultAppState, type AppState } from "./useAppState.ts";

/**
 * How pinning, unpinning, freezing and restoring change the pins and the chart, kept apart from
 * React so they can be tested
 */

/** The frozen pins' keys (getFrozenKey), to not freeze the same row with the same settings twice */
export const getFrozenKeys = (pins: readonly Pin[]) =>
  new Set(pins.flatMap((pin) => (pin.frozen ? [getFrozenKey(pin.frozen.request)] : [])));

/** @returns why a live pin with this request can't be frozen, if it can't */
export function getFreezeBlocked(
  request: BuildRequest | undefined,
  frozenKeys: ReadonlySet<string>,
) {
  if (!request) return "Can't be frozen: the weapon or its attack wasn't found";
  if (frozenKeys.has(getFrozenKey(storeRequest(request)))) {
    return "Already frozen with these settings";
  }
  return undefined;
}

/**
 * The chart's keys with a row that's pinned live charted by its pin's key, so the row's checkbox and
 * the pin's are the same (it's one line), and keys of pins that are gone dropped
 */
export function mergeChartKeys(chartWeapons: readonly string[], pins: readonly Pin[]) {
  const livePinKeys = new Map(
    pins.filter((pin) => !pin.frozen).map((pin) => [getKeyOfPin(pin), getPinChartKey(pin)]),
  );
  const pinKeys = new Set(pins.map(getPinChartKey));
  return [
    ...new Set(
      chartWeapons.flatMap((key) =>
        key.startsWith("pin:") ? (pinKeys.has(key) ? [key] : []) : [livePinKeys.get(key) ?? key],
      ),
    ),
  ];
}

/**
 * The chart's keys after charted pins are unpinned: a live pin's row in the table stays charted by
 * its own key
 * @param rowKeysByPinChartKey the table's rows' keys by the chart keys of the live pins they're for
 */
function unchartPins(
  chartWeapons: readonly string[],
  isUnpinned: (chartKey: string) => boolean,
  rowKeysByPinChartKey: ReadonlyMap<string, string>,
) {
  return chartWeapons.flatMap((key) => {
    if (!isUnpinned(key)) return [key];
    const rowKey = rowKeysByPinChartKey.get(key);
    return rowKey ? [rowKey] : [];
  });
}

export function unpin(
  { pins, chartWeapons }: Pick<AppState, "pins" | "chartWeapons">,
  id: string,
  rowKeysByPinChartKey: ReadonlyMap<string, string>,
): Partial<AppState> {
  const chartKey = `pin:${id}`;
  return {
    pins: pins.filter((pin) => pin.id !== id),
    ...(chartWeapons.includes(chartKey) && {
      chartWeapons: unchartPins(chartWeapons, (key) => key === chartKey, rowKeysByPinChartKey),
    }),
  };
}

export function unpinAll(
  { chartWeapons }: Pick<AppState, "chartWeapons">,
  rowKeysByPinChartKey: ReadonlyMap<string, string>,
): Partial<AppState> {
  return {
    pins: [],
    chartWeapons: unchartPins(chartWeapons, (key) => key.startsWith("pin:"), rowKeysByPinChartKey),
  };
}

/**
 * Freezes a live pin with its current request and settings, or unfreezes a frozen one. Its chart key
 * stays the same, so a charted pin stays charted (by itself only: its row in the table isn't the
 * same row any more, and isn't charted).
 * @param request the pin's current request, to freeze it with
 * @returns the pins after, the same if it can't be frozen
 */
export function toggleFreeze(
  pins: readonly Pin[],
  id: string,
  request: BuildRequest | undefined,
  settings: PinSettings,
): Pin[] {
  return pins.flatMap((pin): Pin[] => {
    if (pin.id !== id) return [pin];
    // Unfreezing a pin that's also pinned live just leaves the live one, which is the same
    if (pin.frozen) {
      const { frozen: _, ...live } = pin;
      const key = getKeyOfPin(pin);
      return pins.some((other) => !other.frozen && getKeyOfPin(other) === key) ? [] : [live];
    }
    if (!request || getFreezeBlocked(request, getFrozenKeys(pins))) return [pin];
    return [{ ...pin, frozen: { request: storeRequest(request), settings } }];
  });
}

/**
 * @returns the settings to go back to a frozen pin's, with its upgrade level picked too so its row is
 * in the table, or undefined if it isn't frozen
 */
export function getRestoredSettings(
  pin: Pin,
  { upgradeLevels }: Pick<AppState, "upgradeLevels">,
): Partial<AppState> | undefined {
  if (!pin.frozen) return undefined;
  // (pins frozen when there was one upgrade level have it in their settings)
  const { upgradeLevel: _, ...settings } = pin.frozen.settings as PinSettings & {
    upgradeLevel?: number;
  };
  return {
    ...settings,
    // Pins frozen before a limit was added don't have it
    limits: { ...defaultAppState.limits, ...settings.limits },
    ...(!upgradeLevels.includes(pin.upgradeLevel) && {
      upgradeLevels: [...upgradeLevels, pin.upgradeLevel].sort((a, b) => a - b),
    }),
  };
}
