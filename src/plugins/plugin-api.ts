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

export function createPluginApi(
  pluginId: string,
  onRegisterTool: (tool: RegisteredTool) => void,
): PluginApi {
  const pluginLogger = rootLogger.child({ pluginId });

  const noop = () => {
    pluginLogger.debug('Unimplemented SDK method called');
  };

  return {
    registerTool(tool: Omit<RegisteredTool, 'pluginId'>) {
      onRegisterTool({ ...tool, pluginId });
    },
    registerChannel: noop,
    registerProvider: noop,
    registerSpeechProvider: noop,
    registerMediaUnderstandingProvider: noop,
    registerImageGenerationProvider: noop,
    registerWebSearchProvider: noop,
    registerHttpRoute: noop,
    registerHook: noop,
    on: noop,
    registerCommand: noop,
    registerCli: noop,
    registerService: noop,
    registerContextEngine: noop,
    config: {},
    logger: {
      info: pluginLogger.info.bind(pluginLogger),
      warn: pluginLogger.warn.bind(pluginLogger),
      error: pluginLogger.error.bind(pluginLogger),
      debug: pluginLogger.debug.bind(pluginLogger),
    },
  };
}
