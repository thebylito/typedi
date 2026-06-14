import 'reflect-metadata';
import { ServiceNotFoundError } from '../../src/error/service-not-found.error';
import { Token } from '../../src/token.class';

describe('ServiceNotFoundError', function () {
  it('should include a string identifier verbatim in the message', () => {
    const error = new ServiceNotFoundError('my-service');

    expect(error.message).toContain('"my-service"');
  });

  it('should describe a Token identifier with its name', () => {
    const error = new ServiceNotFoundError(new Token('MyToken'));

    expect(error.message).toContain('Token<MyToken>');
  });

  it('should describe a constructable identifier with its name', () => {
    class MyService {}

    const error = new ServiceNotFoundError(MyService);

    expect(error.message).toContain('MaybeConstructable<MyService>');
  });

  it('should fall back to the prototype name when the identifier has no own name', () => {
    /** Reproduces the previous dead `||` between template strings, which always yielded `<undefined>`. */
    const legacyIdentifier = { prototype: { name: 'LegacyService' } } as any;

    const error = new ServiceNotFoundError(legacyIdentifier);

    expect(error.message).toContain('MaybeConstructable<LegacyService>');
    expect(error.message).not.toContain('undefined');
  });
});
