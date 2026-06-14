import { Container } from './container.class';
import { ServiceNotFoundError } from './error/service-not-found.error';
import { CannotInstantiateValueError } from './error/cannot-instantiate-value.error';
import { Token } from './token.class';
import { Constructable } from './types/constructable.type';
import { AbstractConstructable } from './types/abstract-constructable.type';
import { ServiceIdentifier } from './types/service-identifier.type';
import { ServiceMetadata } from './interfaces/service-metadata.interface';
import { ServiceOptions } from './interfaces/service-options.interface';
import { EMPTY_VALUE } from './empty.const';

/**
 * Names of the built-in types that cannot be resolved from the container and are therefore
 * skipped when injecting reflected constructor parameters. Hoisted to module scope so the
 * lookup set is allocated once instead of on every parameter of every instantiation.
 */
const PRIMITIVE_PARAM_TYPE_NAMES = new Set(['string', 'boolean', 'number', 'object']);

/**
 * Caches the reflected `design:paramtypes` of each service type. The emitted metadata is static
 * for a given class, so reading it from `Reflect` once and reusing it avoids a metadata lookup on
 * every instantiation — which matters most for transient services that are re-created on each `get`.
 */
const reflectedParamTypesCache = new WeakMap<Function, any[]>();

/**
 * TypeDI can have multiple containers.
 * One container is ContainerInstance.
 */
export class ContainerInstance {
  /** Container instance id. */
  public readonly id!: string;

  /**
   * All registered services in the container, indexed by their service identifier.
   *
   * Each identifier maps to a list of metadata so that services registered with the
   * `multiple: true` flag can share a single id. For the common (single) case the list
   * holds exactly one entry. Using a `Map` keeps `findService`/`findAllServices` at O(1)
   * instead of the previous O(n) linear scan over a flat array.
   */
  private services: Map<ServiceIdentifier, ServiceMetadata<unknown>[]> = new Map();

  constructor(id: string) {
    this.id = id;
  }

  /**
   * Checks if the service with given name or type is registered service container.
   * Optionally, parameters can be passed in case if instance is initialized in the container for the first time.
   */
  has<T>(type: Constructable<T>): boolean;
  has(id: string): boolean;
  has<T>(id: Token<T>): boolean;
  has(identifier: ServiceIdentifier): boolean {
    if (this.findService(identifier) !== undefined) {
      return true;
    }

    /**
     * Mirror `get()`/`getMany()`: a child container can also resolve services registered on the
     * global container, so `has()` must report those as available too. Without this, `has()` could
     * return `false` for an identifier that `get()` resolves successfully via the global fallback.
     */
    const globalContainer = Container.of(undefined);

    return this !== globalContainer && globalContainer.findService(identifier) !== undefined;
  }

  /**
   * Retrieves the service with given name or type from the service container.
   * Optionally, parameters can be passed in case if instance is initialized in the container for the first time.
   */
  get<T>(type: Constructable<T>): T;
  get<T>(type: AbstractConstructable<T>): T;
  get<T>(id: string): T;
  get<T>(id: Token<T>): T;
  get<T>(id: ServiceIdentifier<T>): T;
  get<T>(identifier: ServiceIdentifier<T>): T {
    const globalContainer = Container.of(undefined);

    /**
     * Fast path for the global container, which is the most common case (e.g. `Container.get(...)`).
     * There is no parent container to fall back to, so the global and scoped lookups would be the
     * same single lookup. Resolving it once here avoids a redundant `findService` on every call.
     */
    if (this === globalContainer) {
      const service = this.findService(identifier);

      if (service) return this.getServiceValue(service);

      throw new ServiceNotFoundError(identifier);
    }

    const globalService = globalContainer.findService(identifier);
    const scopedService = this.findService(identifier);

    if (globalService && globalService.global === true) return this.getServiceValue(globalService);

    if (scopedService) return this.getServiceValue(scopedService);

    /** If it's the first time requested in the child container we load it from parent and set it. */
    if (globalService && this !== globalContainer) {
      /**
       * Transient services must yield a fresh value on every request, so they are never stored or
       * cached in this (child) container — otherwise the cloned copy below would turn a transient
       * service into a per-container singleton. We resolve a new value using `this` container so
       * any scoped dependencies are still resolved from here. `getServiceValue` never mutates
       * transient metadata, so resolving directly against the parent's metadata is safe.
       */
      if (globalService.transient === true) {
        return this.getServiceValue(globalService);
      }

      const clonedService = { ...globalService };
      clonedService.value = EMPTY_VALUE;

      /**
       * We need to immediately set the empty value from the root container
       * to prevent infinite lookup in cyclic dependencies.
       */
      this.set(clonedService);

      const value = this.getServiceValue(clonedService);
      this.set({ ...clonedService, value });

      return value;
    }

    if (globalService) return this.getServiceValue(globalService);

    throw new ServiceNotFoundError(identifier);
  }

  /**
   * Gets all instances registered in the container of the given service identifier.
   * Used when service defined with multiple: true flag.
   */
  getMany<T>(type: Constructable<T>): T[];
  getMany<T>(type: AbstractConstructable<T>): T[];
  getMany<T>(id: string): T[];
  getMany<T>(id: Token<T>): T[];
  getMany<T>(id: ServiceIdentifier<T>): T[];
  getMany<T>(identifier: ServiceIdentifier<T>): T[] {
    const localServices = this.findAllServices(identifier);

    if (localServices.length > 0) {
      return localServices.map(service => this.getServiceValue(service));
    }

    /**
     * Mirror `get()`: when nothing is registered locally we fall back to the global container so
     * that globally-registered `multiple: true` services are still returned from a child container.
     * Without this fallback `getMany` returns an empty array from any child container, unlike `get`.
     */
    const globalContainer = Container.of(undefined);

    if (this !== globalContainer) {
      return globalContainer.findAllServices(identifier).map(service => this.getServiceValue(service));
    }

    return [];
  }

  /**
   * Sets a value for the given type or service name in the container.
   */
  set<T = unknown>(service: ServiceMetadata<T>): this; // This should be hidden
  set<T = unknown>(type: Constructable<T>, instance: T): this;
  set<T = unknown>(type: AbstractConstructable<T>, instance: T): this;
  set<T = unknown>(name: string, instance: T): this;
  set<T = unknown>(token: Token<T>, instance: T): this;
  set<T = unknown>(token: ServiceIdentifier, instance: T): this;
  set<T = unknown>(metadata: ServiceOptions<T>): this;
  set<T = unknown>(metadataArray: ServiceOptions<T>[]): this;
  set<T = unknown>(
    identifierOrServiceMetadata: ServiceIdentifier | ServiceOptions<T> | ServiceOptions<T>[],
    value?: T
  ): this {
    if (identifierOrServiceMetadata instanceof Array) {
      identifierOrServiceMetadata.forEach(data => this.set(data));

      return this;
    }

    if (typeof identifierOrServiceMetadata === 'string' || identifierOrServiceMetadata instanceof Token) {
      return this.set({
        id: identifierOrServiceMetadata,
        type: null,
        value: value,
        factory: undefined,
        global: false,
        multiple: false,
        eager: false,
        transient: false,
      });
    }

    if (typeof identifierOrServiceMetadata === 'function') {
      return this.set({
        id: identifierOrServiceMetadata,
        // TODO: remove explicit casting
        type: identifierOrServiceMetadata as Constructable<unknown>,
        value: value,
        factory: undefined,
        global: false,
        multiple: false,
        eager: false,
        transient: false,
      });
    }

    const newService: ServiceMetadata<T> = {
      id: new Token('UNREACHABLE'),
      type: null,
      factory: undefined,
      value: EMPTY_VALUE,
      global: false,
      multiple: false,
      eager: false,
      transient: false,
      ...identifierOrServiceMetadata,
    };

    const service = this.findService(newService.id);

    if (service && service.multiple !== true) {
      Object.assign(service, newService);
    } else {
      const existingServices = this.services.get(newService.id);

      if (existingServices !== undefined) {
        existingServices.push(newService);
      } else {
        this.services.set(newService.id, [newService]);
      }
    }

    if (newService.eager) {
      this.get(newService.id);
    }

    return this;
  }

  /**
   * Removes services with a given service identifiers.
   */
  public remove(identifierOrIdentifierArray: ServiceIdentifier | ServiceIdentifier[]): this {
    if (Array.isArray(identifierOrIdentifierArray)) {
      identifierOrIdentifierArray.forEach(id => this.remove(id));
    } else {
      const services = this.services.get(identifierOrIdentifierArray);

      if (services !== undefined) {
        services.forEach(service => this.destroyServiceInstance(service));
        this.services.delete(identifierOrIdentifierArray);
      }
    }

    return this;
  }

  /**
   * Completely resets the container by removing all previously registered services from it.
   */
  public reset(options: { strategy: 'resetValue' | 'resetServices' } = { strategy: 'resetValue' }): this {
    switch (options.strategy) {
      case 'resetValue':
        this.services.forEach(services => services.forEach(service => this.destroyServiceInstance(service)));
        break;
      case 'resetServices':
        this.services.forEach(services => services.forEach(service => this.destroyServiceInstance(service)));
        this.services.clear();
        break;
      default:
        throw new Error('Received invalid reset strategy.');
    }
    return this;
  }

  /**
   * Returns all services registered with the given identifier.
   */
  private findAllServices(identifier: ServiceIdentifier): ServiceMetadata<unknown>[] {
    return this.services.get(identifier) ?? [];
  }

  /**
   * Finds registered service in the with a given service identifier.
   */
  private findService(identifier: ServiceIdentifier): ServiceMetadata<unknown> | undefined {
    const services = this.services.get(identifier);

    return services !== undefined ? services[0] : undefined;
  }

  /**
   * Gets the value belonging to `serviceMetadata.id`.
   *
   * - if `serviceMetadata.value` is already set it is immediately returned
   * - otherwise the requested type is resolved to the value saved to `serviceMetadata.value` and returned
   */
  private getServiceValue(serviceMetadata: ServiceMetadata<unknown>): any {
    let value: unknown = EMPTY_VALUE;

    /**
     * If the service value has been set to anything prior to this call we return that value.
     * NOTE: This part builds on the assumption that transient dependencies has no value set ever.
     */
    if (serviceMetadata.value !== EMPTY_VALUE) {
      return serviceMetadata.value;
    }

    /** If both factory and type is missing, we cannot resolve the requested ID. */
    if (!serviceMetadata.factory && !serviceMetadata.type) {
      throw new CannotInstantiateValueError(serviceMetadata.id);
    }

    /**
     * If a factory is defined it takes priority over creating an instance via `new`.
     * The return value of the factory is not checked, we believe by design that the user knows what he/she is doing.
     */
    if (serviceMetadata.factory) {
      /**
       * If we received the factory in the [Constructable<Factory>, "functionName"] format, we need to create the
       * factory first and then call the specified function on it.
       */
      if (serviceMetadata.factory instanceof Array) {
        let factoryInstance;

        try {
          /** Try to get the factory from TypeDI first, if failed, fall back to simply initiating the class. */
          factoryInstance = this.get<any>(serviceMetadata.factory[0]);
        } catch (error) {
          if (error instanceof ServiceNotFoundError) {
            factoryInstance = new serviceMetadata.factory[0]();
          } else {
            throw error;
          }
        }

        value = factoryInstance[serviceMetadata.factory[1]](this, serviceMetadata.id);
      } else {
        /** If only a simple function was provided we simply call it. */
        value = serviceMetadata.factory(this, serviceMetadata.id);
      }
    }

    /**
     * If no factory was provided and only then, we create the instance from the type if it was set.
     */
    if (!serviceMetadata.factory && serviceMetadata.type) {
      const constructableTargetType: Constructable<unknown> = serviceMetadata.type;
      // setup constructor parameters for a newly initialized service
      let paramTypes: any[];
      const cachedParamTypes = reflectedParamTypesCache.get(constructableTargetType);
      if (cachedParamTypes !== undefined) {
        paramTypes = cachedParamTypes;
      } else {
        paramTypes = (Reflect as any)?.getMetadata('design:paramtypes', constructableTargetType) || [];
        reflectedParamTypesCache.set(constructableTargetType, paramTypes);
      }
      const params = this.initializeParams(constructableTargetType, paramTypes);

      // "extra feature" - always pass container instance as the last argument to the service function
      // this allows us to support javascript where we don't have decorators and emitted metadata about dependencies
      // need to be injected, and user can use provided container to get instances he needs
      params.push(this);

      value = new constructableTargetType(...params);

      // TODO: Calling this here, leads to infinite loop, because @Inject decorator registerds a handler
      // TODO: which calls Container.get, which will check if the requested type has a value set and if not
      // TODO: it will start the instantiation process over. So this is currently called outside of the if branch
      // TODO: after the current value has been assigned to the serviceMetadata.
      // this.applyPropertyHandlers(constructableTargetType, value as Constructable<unknown>);
    }

    /** If this is not a transient service, and we resolved something, then we set it as the value. */
    if (!serviceMetadata.transient && value !== EMPTY_VALUE) {
      serviceMetadata.value = value;
    }

    if (value === EMPTY_VALUE) {
      /** This branch should never execute, but better to be safe than sorry. */
      throw new CannotInstantiateValueError(serviceMetadata.id);
    }

    if (serviceMetadata.type) {
      this.applyPropertyHandlers(serviceMetadata.type, value as Record<string, any>);
    }

    return value;
  }

  /**
   * Initializes all parameter types for a given target service class.
   */
  private initializeParams(target: Function, paramTypes: any[]): unknown[] {
    /**
     * @Inject()-ed values are stored as parameter handlers and they reference their target
     * when created. So when a class is extended the @Inject()-ed values are not inherited
     * because the handler still points to the old object only.
     *
     * As a quick fix a single level parent lookup is added via `Object.getPrototypeOf(target)`,
     * however this should be updated to a more robust solution.
     *
     * TODO: Add proper inheritance handling: either copy the handlers when a class is registered what
     * TODO: has it's parent already registered as dependency or make the lookup search up to the base Object.
     *
     * The handler sets only depend on `target`, so we look them up once here instead of for every
     * parameter. The parent handlers are checked first to preserve the original registration order
     * (a parent class is always registered before the class extending it). When no handlers are
     * registered at all (e.g. plain constructor injection via reflected types) we skip the lookups
     * entirely so the prototype walk and map reads are not paid on every instantiation.
     */
    const hasHandlers = Container.handlers.length !== 0;
    const inheritedParamHandlers = hasHandlers
      ? Container.getHandlersForObject(Object.getPrototypeOf(target))
      : undefined;
    const ownParamHandlers = hasHandlers ? Container.getHandlersForObject(target) : undefined;

    return paramTypes.map((paramType, index) => {
      const paramHandler =
        inheritedParamHandlers?.find(handler => handler.index === index) ??
        ownParamHandlers?.find(handler => handler.index === index);

      if (paramHandler) return paramHandler.value(this);

      if (paramType && paramType.name && !this.isPrimitiveParamType(paramType.name)) {
        return this.get(paramType);
      }

      return undefined;
    });
  }

  /**
   * Checks if given parameter type is primitive type or not.
   */
  private isPrimitiveParamType(paramTypeName: string): boolean {
    return PRIMITIVE_PARAM_TYPE_NAMES.has(paramTypeName.toLowerCase());
  }

  /**
   * Applies all registered handlers on a given target class.
   */
  private applyPropertyHandlers(target: Function, instance: { [key: string]: any }) {
    /** Nothing to apply when no handlers are registered at all — skips walking the prototype chain entirely. */
    if (Container.handlers.length === 0) return;

    /**
     * Property handlers are registered against the class prototype (`handler.object`). A handler
     * applies to `target` when its prototype is anywhere in `target`'s prototype chain, which is
     * how the previous `instanceof`-based check selected them. We walk that chain from the base
     * ancestor down to `target` so subclasses override the property values set by their parents,
     * matching the original registration order (parents are always registered first).
     */
    const prototypeChain: object[] = [];
    let prototype: object | null = target.prototype;

    while (prototype) {
      prototypeChain.push(prototype);
      prototype = Object.getPrototypeOf(prototype);
    }

    for (let chainIndex = prototypeChain.length - 1; chainIndex >= 0; chainIndex--) {
      const handlers = Container.getHandlersForObject(prototypeChain[chainIndex]);

      if (handlers === undefined) continue;

      handlers.forEach(handler => {
        if (typeof handler.index === 'number') return;

        if (handler.propertyName) {
          instance[handler.propertyName] = handler.value(this);
        }
      });
    }
  }

  /**
   * Checks if the given service metadata contains a destroyable service instance and destroys it in place. If the service
   * contains a callable function named `destroy` it is called but not awaited and the return value is ignored..
   *
   * @param serviceMetadata the service metadata containing the instance to destroy
   * @param force when true the service will be always destroyed even if it's cannot be re-created
   */
  private destroyServiceInstance(serviceMetadata: ServiceMetadata, force = false) {
    /** We reset value only if we can re-create it (aka type or factory exists). */
    const shouldResetValue = force || !!serviceMetadata.type || !!serviceMetadata.factory;

    if (shouldResetValue) {
      /** If we wound a function named destroy we call it without any params. */
      if (typeof (serviceMetadata?.value as Record<string, unknown>)['destroy'] === 'function') {
        try {
          (serviceMetadata.value as { destroy: CallableFunction }).destroy();
        } catch (error) {
          /** We simply ignore the errors from the destroy function. */
        }
      }

      serviceMetadata.value = EMPTY_VALUE;
    }
  }
}
