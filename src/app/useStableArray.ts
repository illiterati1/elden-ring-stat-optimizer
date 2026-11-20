import { useRef } from "react";

/**
 * The array from the last render if it has the same elements, so a memoized component given it
 * doesn't render again just because it was worked out again
 */
export default function useStableArray<T>(array: T[]): T[];
export default function useStableArray<T>(array: readonly T[]): readonly T[];
export default function useStableArray<T>(array: readonly T[]) {
  const ref = useRef(array);
  const previous = ref.current;
  if (
    previous !== array &&
    !(previous.length === array.length && previous.every((element, i) => element === array[i]))
  ) {
    ref.current = array;
  }
  return ref.current;
}
