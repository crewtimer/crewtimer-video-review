/**
 * Minimal types for 'conf', the base class of electron-store. Its own types
 * are only reachable through package exports, which this project's
 * "moduleResolution": "node" does not read.
 */
declare module 'conf' {
  export type Schema<T> = { [Property in keyof T]: unknown };

  export type Options<T extends Record<string, any>> = {
    defaults?: Readonly<T>;
    cwd?: string;
    [option: string]: unknown;
  };

  export default class Conf<
    T extends Record<string, any> = Record<string, unknown>,
  > {
    constructor(options?: Partial<Options<T>>);

    readonly path: string;

    get<Key extends keyof T>(key: Key, defaultValue?: T[Key]): T[Key];

    set<Key extends keyof T>(key: Key, value?: T[Key]): void;

    has(key: keyof T): boolean;

    delete(key: keyof T): void;

    clear(): void;
  }
}
