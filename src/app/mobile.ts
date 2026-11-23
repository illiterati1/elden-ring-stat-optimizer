/** The parts of `navigator` that tell a phone or tablet apart (Chromium's User-Agent Client Hints) */
export interface DeviceInfo {
  userAgent: string;
  maxTouchPoints: number;
  userAgentData?: { mobile: boolean };
  /** Whether the primary pointer is a finger (`(pointer: coarse)`) */
  coarsePointer?: boolean;
}

/**
 * @returns whether the browser is on a phone or tablet, where there's no Elden Ring save file to open.
 * Judged by the device, not its screen or input: a Steam Deck (Linux, with a touchscreen) or a touchscreen
 * laptop isn't mobile, since they can run the game. iPads ask for desktop sites, saying they're a Mac, so
 * a "Mac" with a touchscreen is one only when touch is its main input: a touchscreen MacBook's is the
 * trackpad. Chromium browsers on a Mac send client hints, which iPad browsers (all WebKit) don't
 */
export function isMobileDevice(device: DeviceInfo | undefined): boolean {
  if (!device) return false;
  if (device.userAgentData?.mobile) return true;
  const { userAgent } = device;
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(userAgent)) return true;
  return (
    /Macintosh/.test(userAgent) &&
    device.maxTouchPoints > 1 &&
    !device.userAgentData &&
    device.coarsePointer === true
  );
}

export const isMobile = isMobileDevice(
  typeof navigator === "undefined"
    ? undefined
    : {
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
        userAgentData: (navigator as Navigator & Pick<DeviceInfo, "userAgentData">).userAgentData,
        coarsePointer: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
      },
);

export type DesktopOs = "windows" | "mac" | "linux";

/**
 * @returns the desktop OS, for where the save file is: Linux covers a Steam Deck and anything else running
 * the game through Proton. Anything unrecognized is taken to be Windows, where the game runs natively
 */
export function getDesktopOs(userAgent: string): DesktopOs {
  if (/Macintosh|Mac OS X/.test(userAgent)) return "mac";
  if (/Linux|X11/.test(userAgent)) return "linux";
  return "windows";
}

export const desktopOs = getDesktopOs(typeof navigator === "undefined" ? "" : navigator.userAgent);
