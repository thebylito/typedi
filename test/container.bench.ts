import 'reflect-metadata';
import { performance } from 'perf_hooks';
import { Container } from '../src/container.class';
import { Service } from '../src/decorators/service.decorator';
import { Inject } from '../src/decorators/inject.decorator';

type BenchmarkResult = {
  name: string;
  iterations: number;
  totalMs: number;
  averageMs: number;
  operationsPerSecond: number;
};

@Service()
class HandlerLookupTarget {
  constructor(
    public first: string,
    public second: string,
    public third: string,
    public fourth: string,
    public fifth: string
  ) {}
}

@Service()
class CachedSingletonDependency {}

@Service()
class CachedSingletonTarget {
  constructor(public dependency: CachedSingletonDependency) {}
}

@Service({ transient: true })
class TransientLeaf {}

@Service({ transient: true })
class TransientTarget {
  constructor(public constructorLeaf: TransientLeaf) {}
}

@Service({ transient: true })
class InjectedPropertyLeaf {}

@Service({ transient: true })
class TransientPropertyTarget {
  @Inject(() => InjectedPropertyLeaf)
  injected: InjectedPropertyLeaf;
}

function benchmark(name: string, iterations: number, action: () => void): BenchmarkResult {
  for (let warmupIndex = 0; warmupIndex < 25; warmupIndex++) {
    action();
  }

  const startedAt = performance.now();

  for (let iteration = 0; iteration < iterations; iteration++) {
    action();
  }

  const totalMs = performance.now() - startedAt;

  return {
    name,
    iterations,
    totalMs,
    averageMs: totalMs / iterations,
    operationsPerSecond: iterations / (totalMs / 1000),
  };
}

function registerUnrelatedParameterHandlers(total: number) {
  for (let handlerIndex = 0; handlerIndex < total; handlerIndex++) {
    class NoiseTarget {}

    Container.registerHandler({
      object: NoiseTarget,
      index: handlerIndex % 5,
      value: () => `noise-${handlerIndex}`,
    });
  }
}

function setupHandlerLookupScenario(noiseHandlerCount: number) {
  Container.reset();

  registerUnrelatedParameterHandlers(noiseHandlerCount);

  ['first', 'second', 'third', 'fourth', 'fifth'].forEach((value, index) => {
    Container.registerHandler({
      object: HandlerLookupTarget,
      index,
      value: () => value,
    });
  });

  Container.set({ id: HandlerLookupTarget, type: HandlerLookupTarget });
}

function setupServiceLookupScenario(serviceCount: number) {
  Container.reset();

  for (let serviceIndex = 0; serviceIndex < serviceCount; serviceIndex++) {
    Container.set(`service-${serviceIndex}`, serviceIndex);
  }

  Container.set('lookup-target', 'lookup-target-value');
}

function setupCachedSingletonScenario() {
  Container.reset();
  Container.get(CachedSingletonTarget);
}

function setupTransientScenario() {
  /** `reset()` uses the `resetValue` strategy, so the @Service registrations survive; transient services are never cached. */
  Container.reset();
}

function setupTransientPropertyInjectionScenario() {
  /** `reset()` clears handlers, so we re-register the @Inject() property handler the decorator created. */
  Container.reset();
  Container.registerHandler({
    /** Property handlers are registered against the prototype, mirroring what the @Inject() decorator stores. */
    object: (TransientPropertyTarget.prototype as unknown) as typeof TransientPropertyTarget,
    propertyName: 'injected',
    value: container => container.get(InjectedPropertyLeaf),
  });
}

function setupContainerOfScenario(containerCount: number) {
  for (let containerIndex = 0; containerIndex < containerCount; containerIndex++) {
    Container.of(`of-scope-${containerIndex}`);
  }
}

function formatResult(result: BenchmarkResult): string {
  return [
    result.name.padEnd(42),
    `avg ${result.averageMs.toFixed(4)} ms`,
    `total ${result.totalMs.toFixed(2)} ms`,
    `${Math.round(result.operationsPerSecond).toString().padStart(7)} ops/s`,
  ].join(' | ');
}

function runBenchmarks() {
  const rootContainer = Container.of();

  setupHandlerLookupScenario(2000);
  const handlerLookupResult = benchmark('cold resolve with 2k unrelated handlers', 250, () => {
    rootContainer.reset();
    Container.get(HandlerLookupTarget);
  });

  setupServiceLookupScenario(5000);
  const serviceLookupResult = benchmark('lookup with 5k registered services', 50000, () => {
    Container.get('lookup-target');
  });

  setupCachedSingletonScenario();
  const cachedSingletonResult = benchmark('cached singleton get', 100000, () => {
    Container.get(CachedSingletonTarget);
  });

  setupTransientScenario();
  const transientResult = benchmark('transient resolve with dependency', 100000, () => {
    Container.get(TransientTarget);
  });

  setupTransientPropertyInjectionScenario();
  const transientPropertyResult = benchmark('transient resolve with @Inject property', 100000, () => {
    Container.get(TransientPropertyTarget);
  });

  const containerCount = 2000;
  setupContainerOfScenario(containerCount);
  const lastContainerId = `of-scope-${containerCount - 1}`;
  const containerOfResult = benchmark('Container.of lookup with 2k containers', 100000, () => {
    Container.of(lastContainerId);
  });

  console.log('TypeDI container benchmark');
  console.log(formatResult(handlerLookupResult));
  console.log(formatResult(serviceLookupResult));
  console.log(formatResult(cachedSingletonResult));
  console.log(formatResult(transientResult));
  console.log(formatResult(transientPropertyResult));
  console.log(formatResult(containerOfResult));
}

runBenchmarks();
