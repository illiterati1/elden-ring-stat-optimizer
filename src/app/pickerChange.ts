/**
 * Whether the latest settings change was picking an option from a picker (an autocomplete or select
 * list), so its calculation can start as soon as the picker has closed, rather than waiting as long
 * as after typing, spinning or ticking a box, which may be repeated
 */
let latestChangeFromPicker = false;

/** Notes where a settings change came from: call it from the event handler that makes it */
export function noteSettingsChange() {
  const target = typeof window === "undefined" ? undefined : window.event?.target;
  latestChangeFromPicker =
    target instanceof Element && target.closest('[role="option"], [role="combobox"]') != null;
}

export function isLatestChangeFromPicker() {
  return latestChangeFromPicker;
}

/**
 * Calls back once no picker's list is open (and a frame later, so the closed picker is drawn before
 * a calculation holds up the page), or after the timeout if one stays open
 * @returns a function that cancels it
 */
export function afterPickersClose(callback: () => void, timeoutMs: number) {
  const startTime = performance.now();
  let frame = 0;
  let closedFrames = 0;
  const check = () => {
    const open = document.querySelector('[role="listbox"]') != null;
    closedFrames = open ? 0 : closedFrames + 1;
    if (closedFrames >= 2 || performance.now() - startTime >= timeoutMs) {
      callback();
    } else {
      frame = requestAnimationFrame(check);
    }
  };
  frame = requestAnimationFrame(check);
  return () => cancelAnimationFrame(frame);
}
