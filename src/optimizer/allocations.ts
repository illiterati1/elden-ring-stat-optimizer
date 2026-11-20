import { allAttributes, type Attributes } from "../calculator/attributes.ts";

const width = allAttributes.length;

/**
 * Leveled attributes for each of a list of levels, as one byte per attribute in allAttributes
 * order. A curve has one for each of hundreds of levels, and many curves are cached and sent
 * between threads, so this takes far less memory than an object for each.
 */
export type PackedAllocations = Uint8Array;

export function packAllocations(allocations: readonly Attributes[]): PackedAllocations {
  const packed = new Uint8Array(allocations.length * width);
  allocations.forEach((allocation, n) =>
    allAttributes.forEach((attribute, i) => {
      const value = allocation[attribute];
      if (!(value >= 0 && value <= 255 && Number.isInteger(value))) {
        throw new Error(`Can't pack ${attribute} ${value}`);
      }
      packed[n * width + i] = value;
    }),
  );
  return packed;
}

export function getAllocationCount(packed: PackedAllocations) {
  return packed.length / width;
}

/** @returns the nth allocation */
export function getAllocation(packed: PackedAllocations, n: number): Attributes {
  const offset = n * width;
  if (offset < 0 || offset >= packed.length) {
    throw new RangeError(`No allocation ${n} of ${getAllocationCount(packed)}`);
  }
  const allocation = {} as Attributes;
  allAttributes.forEach((attribute, i) => (allocation[attribute] = packed[offset + i]));
  return allocation;
}

/** @returns a copy of allocations [start, end), not sharing the original's memory */
export function sliceAllocations(packed: PackedAllocations, start: number, end?: number) {
  return packed.slice(start * width, end === undefined ? undefined : end * width);
}
