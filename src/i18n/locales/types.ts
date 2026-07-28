import type { Resources } from './en';

/**
 * The English file uses `as const`, so its values are literal types. Widening
 * them to `string` gives the shape a translation must satisfy: every key
 * present, no key invented.
 *
 * This is what makes a missing translation a compile error instead of a string
 * that silently renders as its own dotted key in front of a user.
 */
type Stringify<T> = {
  [K in keyof T]: T[K] extends string ? string : Stringify<T[K]>;
};

export type Translation = Stringify<Resources>;
