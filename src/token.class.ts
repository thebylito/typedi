/**
 * Used to create unique typed service identifier.
 * Useful when service has only interface, but don't have a class.
 *
 * The generic parameter is a phantom type used purely for compile-time service typing
 * (e.g. `new Token<MyService>()`); it intentionally has no runtime usage.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class Token<T> {
  /**
   * @param name Token name, optional and only used for debugging purposes.
   */
  constructor(public name?: string) {}
}
