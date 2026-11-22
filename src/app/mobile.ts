/** The parts of `navigator` that tell a phone or tablet apart (Chromium's User-Agent Client Hints) */
export interface DeviceInfo {
  userAgent: string;
  maxTouchPoints: number;
  userAgentData?: { mobile: boolean };
}

/**
 * @returns whether the browser is on a phone or tablet, where there's no Elden Ring save file to open.
 * Judged by the device, not its screen or input: a Steam Deck (Linux, with a touchscreen) or a touchscreen
 * laptop isn't mobile, since they can run the game. iPads ask for desktop sites, saying they're a Mac, so
 * a "Mac" with a touchscreen is one
 */
export function isMobileDevice(device: DeviceInfo | undefined): boolean {
  if (!device) return false;
  if (device.userAgentData?.mobile) return true;
  const { userAgent } = device;
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && device.maxTouchPoints > 1;
}

export const isMobile = isMobileDevice(
  typeof navigator === "undefined" ? undefined : (navigator as Navigator & DeviceInfo),
);
