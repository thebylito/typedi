import { ContainerInstance } from './container-instance.class';
import { Token } from './token.class';
import { Handler } from './interfaces/handler.interface';
import { Constructable } from './types/constructable.type';
import { ServiceIdentifier } from './types/service-identifier.type';
import { ServiceOptions } from './interfaces/service-options.interface';
import { AbstractConstructable } from './types/abstract-constructable.type';

/**
 * Service container.
 */
export class Container {
  /**
   * All registered handlers. The @Inject() decorator uses handlers internally to mark a property for injection.
   **/
  static readonly handlers: Handler[] = [];

  /**
   * Handlers indexed by the object they are registered against, kept in sync with `handlers`.
   *
   * The key is the service class (for constructor-parameter handlers) or the class prototype
   * (for property handlers), mirroring what the @Inject() decorator stores in `handler.object`.
   * This index lets the container resolve the handlers relevant to a single class in O(1)
   * instead of scanning the entire (potentially large) `handlers` list on every instantiation.
   */
  private static readonly handlersByObject: Map<object, Handler[]> = new Map();

  /**  Global container instance. */
  private static readonly globalInstance: ContainerInstance = new ContainerInstance('default');

  /** Other containers created using Container.of method, indexed by their id. */
  private static readonly instances: Map<string, ContainerInstance> = new Map();

  /**
   * Gets a separate container instance for the given instance id.
   */
  static of(containerId: string = 'default'): ContainerInstance {
    if (containerId === 'default') return this.globalInstance;

    let container = this.instances.get(containerId);
    if (!container) {
      container = new ContainerInstance(containerId);
      this.instances.set(containerId, container);
      // TODO: Why we are not reseting here? Let's reset here. (I have added the commented code.)
      // container.reset();
    }

    return container;
  }

  /**
   * Checks if the service with given name or type is registered service container.
   * Optionally, parameters can be passed in case if instance is initialized in the container for the first time.
   */
  static has<T>(type: Constructable<T>): boolean;
  static has(id: string): boolean;
  static has<T>(id: Token<T>): boolean;
  static has(identifier: ServiceIdentifier): boolean {
    return this.globalInstance.has(identifier as any);
  }

  /**
   * Retrieves the service with given name or type from the service container.
   * Optionally, parameters can be passed in case if instance is initialized in the container for the first time.
   */
  static get<T>(type: Constructable<T>): T;
  static get<T>(type: AbstractConstructable<T>): T;
  static get<T>(id: string): T;
  static get<T>(id: Token<T>): T;
  static get<T>(identifier: ServiceIdentifier<T>): T {
    return this.globalInstance.get(identifier as any);
  }

  /**
   * Gets all instances registered in the container of the given service identifier.
   * Used when service defined with multiple: true flag.
   */
  static getMany<T>(id: string): T[];
  static getMany<T>(id: Token<T>): T[];
  static getMany<T>(id: string | Token<T>): T[] {
    return this.globalInstance.getMany(id as any);
  }

  /**
   * Sets a value for the given type or service name in the container.
   */
  static set(type: Function, value: unknown): Container;
  static set<T>(type: Constructable<T>, value: T): Container;
  static set<T>(type: AbstractConstructable<T>, value: T): Container;
  static set(name: string, value: unknown): Container;
  static set<T>(token: Token<T>, value: T): Container;
  static set<T = unknown>(value: ServiceOptions<T>): Container;
  static set<T = unknown>(values: ServiceOptions<T>[]): Container;
  static set(
    identifierOrServiceMetadata: ServiceIdentifier | ServiceOptions<any> | ServiceOptions<any>[],
    value?: any
  ): Container {
    this.globalInstance.set(identifierOrServiceMetadata as any, value);
    return this;
  }

  /**
   * Removes services with a given service identifiers.
   */
  static remove(identifierOrIdentifierArray: ServiceIdentifier | ServiceIdentifier[]): Container {
    this.globalInstance.remove(identifierOrIdentifierArray);

    return this;
  }

  /**
   * Completely resets the container by removing all previously registered services and handlers from it.
   */
  static reset(containerId: string = 'default'): Container {
    if (containerId == 'default') {
      this.globalInstance.reset();
      this.instances.forEach(instance => instance.reset());
      this.handlers.length = 0;
      this.handlersByObject.clear();
    } else {
      const instance = this.instances.get(containerId);
      if (instance) {
        instance.reset();
        this.instances.delete(containerId);
      }
    }
    return this;
  }

  /**
   * Registers a new handler.
   */
  static registerHandler(handler: Handler): Container {
    this.handlers.push(handler);

    const handlersForObject = this.handlersByObject.get(handler.object);

    if (handlersForObject !== undefined) {
      handlersForObject.push(handler);
    } else {
      this.handlersByObject.set(handler.object, [handler]);
    }

    return this;
  }

  /**
   * Returns the handlers registered directly against the given object (a service class for
   * constructor-parameter handlers, or a class prototype for property handlers), or `undefined`
   * when none are registered. Backed by an internal index so lookups stay O(1) regardless of
   * how many handlers exist in total.
   */
  static getHandlersForObject(object: object): Handler[] | undefined {
    return this.handlersByObject.get(object);
  }

  /**
   * Helper method that imports given services.
   */
  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  static import(services: Function[]): Container {
    return this;
  }
}
