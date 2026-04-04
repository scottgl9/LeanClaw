/**
 * Plugin API for the register(api) SDK pattern.
 * Provides the api object passed to plugin register() functions,
 * compatible with OpenClaw's plugin SDK.
 */
import { logger as rootLogger } from '../logger.js';

export interface RegisteredTool {
  name: string;
  description: string;
  parameters: unknown;
  execute(toolCallId: string, params: unknown): Promise<unknown>;
  pluginId: string;
}

export interface PluginApi {
  registerTool(tool: Omit<RegisteredTool, 'pluginId'>): void;
  registerChannel(channel: unknown): void;
  registerProvider(provider: unknown): void;
  registerSpeechProvider(provider: unknown): void;
  registerMediaUnderstandingProvider(provider: unknown): void;
  registerImageGenerationProvider(provider: unknown): void;
  registerWebSearchProvider(provider: unknown): void;
  registerHttpRoute(route: unknown): void;
  registerHook(event: string, fn: Function): void;
  on(event: string, fn: Function): void;
  registerCommand(cmd: unknown): void;
  registerCli(cli: unknown): void;
  registerService(svc: unknown): void;
  registerContextEngine(engine: unknown): void;
  config: unknown;
  logger: { info: Function; warn: Function; error: Function; debug: Function };
}

export interface PluginApiCallbacks {
  onRegisterTool: (tool: RegisteredTool) => void;
  onRegisterChannel: (channel: unknown) => void;
  onRegisterProvider: (provider: unknown) => void;
  onRegisterHook: (event: string, handler: Function) => void;
  onRegisterHttpRoute: (route: { method: string; path: string; handler: Function }) => void;
}

export function createPluginApi(
  pluginId: string,
  callbacks: PluginApiCallbacks,
): PluginApi {
  const pluginLogger = rootLogger.child({ pluginId });

  const noop = (methodName: string) => () => {
    pluginLogger.debug({ method: methodName }, 'Unimplemented SDK method called');
  };

  return {
    registerTool(tool: Omit<RegisteredTool, 'pluginId'>) {
      callbacks.onRegisterTool({ ...tool, pluginId });
    },
    registerChannel(channel: unknown) {
      callbacks.onRegisterChannel(channel);
    },
    registerProvider(provider: unknown) {
      callbacks.onRegisterProvider(provider);
    },
    registerHook(event: string, fn: Function) {
      callbacks.onRegisterHook(event, fn);
    },
    on(event: string, fn: Function) {
      // Alias for registerHook
      callbacks.onRegisterHook(event, fn);
    },
    registerHttpRoute(route: unknown) {
      const r = route as { method?: string; path?: string; handler?: Function };
      if (r && r.path && r.handler) {
        callbacks.onRegisterHttpRoute({
          method: r.method || 'GET',
          path: r.path,
          handler: r.handler,
        });
      } else {
        pluginLogger.warn('registerHttpRoute called with invalid route');
      }
    },
    registerSpeechProvider: noop('registerSpeechProvider'),
    registerMediaUnderstandingProvider: noop('registerMediaUnderstandingProvider'),
    registerImageGenerationProvider: noop('registerImageGenerationProvider'),
    registerWebSearchProvider: noop('registerWebSearchProvider'),
    registerCommand: noop('registerCommand'),
    registerCli: noop('registerCli'),
    registerService: noop('registerService'),
    registerContextEngine: noop('registerContextEngine'),
    config: {},
    logger: {
      info: pluginLogger.info.bind(pluginLogger),
      warn: pluginLogger.warn.bind(pluginLogger),
      error: pluginLogger.error.bind(pluginLogger),
      debug: pluginLogger.debug.bind(pluginLogger),
    },
  };
}
