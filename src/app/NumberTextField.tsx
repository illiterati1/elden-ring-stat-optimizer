import {
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { TextFieldProps } from "@mui/material";
import { Box, IconButton, InputAdornment, SvgIcon, TextField } from "@mui/material";

const clampValue = (x: number, min: number, max: number) => Math.min(Math.max(x, min), max);

/**
 * The value moved by a whole number of steps to the next multiple of the step, rounded to the
 * step's precision. Floating point steps like 0.1 would otherwise give values like
 * 0.30000000000000004, and stepping from slightly over a multiple could land on the same value.
 */
export function stepValue(value: number, step: number, steps: number) {
  const decimals = (step.toString().split(".")[1] ?? "").length;
  const position = value / step;
  const target =
    steps > 0 ? Math.floor(position + 1e-9) + steps : Math.ceil(position - 1e-9) + steps;
  return +(target * step).toFixed(decimals);
}

interface Props extends Omit<TextFieldProps, "value" | "inputMode" | "onKeyDown" | "onChange"> {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange(
    value: number,
    evt:
      | ChangeEvent<HTMLInputElement>
      | KeyboardEvent<HTMLInputElement>
      | FocusEvent<HTMLInputElement>
      | PointerEvent<HTMLButtonElement>,
  ): void;

  /** Show buttons to increment and decrement the value by one step */
  spinButtons?: boolean;

  /** Accept decimals even though the step is a whole number, e.g. an enemy's 123.2 defense */
  allowDecimals?: boolean;

  /**
   * Values the spin buttons and arrow keys move between, instead of by step, e.g. the HP
   * percentages where buffs start or stop applying
   */
  stops?: readonly number[];
}

/** @returns the next of the stops above (steps > 0) or below the value, moving that many stops */
function stepToStop(value: number, stops: readonly number[], steps: number) {
  const ascending = [...stops].sort((a, b) => a - b);
  const descending = [...ascending].reverse();
  let result = value;
  for (let i = 0; i < Math.abs(steps); i++) {
    const next =
      steps > 0
        ? ascending.find((stop) => stop > result)
        : descending.find((stop) => stop < result);
    if (next == null) break;
    result = next;
  }
  return result;
}

const spinButtonSx = { p: 0, borderRadius: 0.5, height: 14, width: 20 };

/** Holding a spin button repeats after this delay, at this interval */
const spinRepeatDelayMs = 400;
const spinRepeatIntervalMs = 60;

function ArrowUpIcon() {
  return (
    <SvgIcon sx={{ fontSize: 20 }}>
      <path d="M7 14l5-5 5 5z" />
    </SvgIcon>
  );
}

function ArrowDownIcon() {
  return (
    <SvgIcon sx={{ fontSize: 20 }}>
      <path d="M7 10l5 5 5-5z" />
    </SvgIcon>
  );
}

export default function NumberTextField({
  value,
  min = -Infinity,
  max = Infinity,
  step = 1,
  onChange,
  spinButtons = false,
  allowDecimals = false,
  stops,
  InputProps,
  ...props
}: Props) {
  const [valueStr, setValueStr] = useState(value.toString());
  const moveBy = (current: number, steps: number) =>
    stops ? stepToStop(current, stops, steps) : stepValue(current, step, steps);

  // Fields with a whole number step only accept whole numbers, unless they allow decimals
  const allowsDecimals = allowDecimals || !Number.isInteger(step);

  // Show the new value if it's changed from outside this field, e.g. by a "copy to all" button
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (+valueStr !== value) {
      setValueStr(value.toString());
    }
  }

  const handleKeyDown = useCallback(
    (evt: KeyboardEvent<HTMLInputElement>) => {
      // Allow typing numbers or using built-in keyboard shortcuts normally
      if (
        evt.altKey ||
        evt.ctrlKey ||
        evt.shiftKey ||
        evt.key.match(/^[0-9]$/) ||
        evt.key.match(/^F[0-9]{1,2}$/) ||
        ["ArrowLeft", "ArrowRight", "Backspace", "Enter", "Tab"].includes(evt.key) ||
        (evt.key === "." && allowsDecimals) ||
        (evt.key === "-" && min < 0)
      ) {
        return;
      }

      evt.preventDefault();

      let newValue = value;

      // Custom keyboard shortcuts: Up/Down increment/decrement by one step, Page Up/Down by 10
      // steps, and Home/End set the value to the minimum or maximum
      if (evt.key === "ArrowUp") {
        newValue = clampValue(moveBy(value, 1), min, max);
      } else if (evt.key === "ArrowDown") {
        newValue = clampValue(moveBy(value, -1), min, max);
      } else if (evt.key === "PageUp") {
        newValue = clampValue(moveBy(value, 10), min, max);
      } else if (evt.key === "PageDown") {
        newValue = clampValue(moveBy(value, -10), min, max);
      } else if (evt.key === "Home" && max != null) {
        newValue = max;
      } else if (evt.key === "End" && min != null) {
        newValue = min;
      }

      if (newValue !== value) {
        onChange(newValue, evt);
        setValueStr(newValue.toString());
      }
    },
    [value, min, max, step, stops, allowsDecimals, onChange],
  );

  const handleChange = useCallback(
    (evt: ChangeEvent<HTMLInputElement>) => {
      const newValueStr = evt.currentTarget.value;

      // Allow clearing the field, or typing a minus sign or decimal point before the rest of the
      // number. These aren't committed until a number is entered.
      if (
        newValueStr === "" ||
        (newValueStr === "-" && min < 0) ||
        (newValueStr === "." && allowsDecimals) ||
        (newValueStr === "-." && allowsDecimals && min < 0)
      ) {
        setValueStr(newValueStr);
        return;
      }

      const newValue = +newValueStr;
      if (isNaN(newValue) || (!allowsDecimals && !Number.isInteger(newValue))) {
        return;
      }

      // Values below the minimum may be the start of a longer number (e.g. "2" on the way to
      // "25"), so they're only clamped on blur
      if (newValue < min) {
        setValueStr(newValueStr);
        return;
      }

      const clamped = clampValue(newValue, min, max);
      setValueStr(newValue === clamped ? newValueStr : clamped.toString());
      onChange?.(clamped, evt);
    },
    [min, max, step, onChange],
  );

  const handleBlur = useCallback(
    (evt: FocusEvent<HTMLInputElement>) => {
      const newValue = +valueStr;
      if (valueStr !== "" && !isNaN(newValue) && newValue < min) {
        onChange(min, evt);
        setValueStr(min.toString());
      } else {
        setValueStr(value.toString());
      }
    },
    [value, valueStr, min, onChange],
  );

  // Spinning repeats while a button is held, so it reads the latest value and onChange from refs
  // rather than from the render where the button was pressed
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const spinTimerRef = useRef<number>();

  const stopSpinning = useCallback(() => {
    window.clearTimeout(spinTimerRef.current);
    window.clearInterval(spinTimerRef.current);
  }, []);

  useEffect(() => stopSpinning, [stopSpinning]);

  const startSpinning = (direction: 1 | -1, evt: PointerEvent<HTMLButtonElement>) => {
    if (evt.button !== 0) return;
    stopSpinning();

    const spin = () => {
      const current = valueRef.current;
      const newValue =
        direction > 0 ? Math.min(moveBy(current, 1), max) : Math.max(moveBy(current, -1), min);
      if (newValue === current) {
        stopSpinning();
        return;
      }
      valueRef.current = newValue;
      onChangeRef.current(newValue, evt);
      setValueStr(newValue.toString());
    };

    spin();
    spinTimerRef.current = window.setTimeout(() => {
      spinTimerRef.current = window.setInterval(spin, spinRepeatIntervalMs);
    }, spinRepeatDelayMs);
  };

  return (
    <TextField
      {...props}
      InputProps={
        spinButtons
          ? {
              ...InputProps,
              sx: { pr: 0.5, ...InputProps?.sx },
              endAdornment: (
                <InputAdornment position="end" sx={{ ml: 0, gap: 0.5 }}>
                  {InputProps?.endAdornment}
                  <Box display="flex" flexDirection="column">
                    <IconButton
                      aria-label="Increase"
                      tabIndex={-1}
                      sx={spinButtonSx}
                      disabled={props.disabled || value >= max}
                      onPointerDown={(evt) => startSpinning(1, evt)}
                      onPointerUp={stopSpinning}
                      onPointerLeave={stopSpinning}
                      onPointerCancel={stopSpinning}
                    >
                      <ArrowUpIcon />
                    </IconButton>
                    <IconButton
                      aria-label="Decrease"
                      tabIndex={-1}
                      sx={spinButtonSx}
                      disabled={props.disabled || value <= min}
                      onPointerDown={(evt) => startSpinning(-1, evt)}
                      onPointerUp={stopSpinning}
                      onPointerLeave={stopSpinning}
                      onPointerCancel={stopSpinning}
                    >
                      <ArrowDownIcon />
                    </IconButton>
                  </Box>
                </InputAdornment>
              ),
            }
          : InputProps
      }
      inputProps={{ inputMode: "decimal" }}
      onKeyDown={handleKeyDown}
      onChange={handleChange}
      onBlur={handleBlur}
      value={valueStr}
    />
  );
}
