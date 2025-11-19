/**
 * AI Provider Factory
 * Creates and manages AI provider instances
 */

import { AIProvider, AIProviderConfig } from './base.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { OllamaProvider } from './ollama.js';

export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'ollama';

export interface ProviderFactoryConfig {
  provider: ProviderType;
  apiKey: string;
  model?: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

export class ProviderFactory {
  private static instance: ProviderFactory;
  private providers: Map<string, AIProvider> = new Map();

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): ProviderFactory {
    if (!ProviderFactory.instance) {
      ProviderFactory.instance = new ProviderFactory();
    }
    return ProviderFactory.instance;
  }

  /**
   * Create a provider instance
   */
  createProvider(config: ProviderFactoryConfig): AIProvider {
    // Build cache key with all non-sensitive configuration values
    // Explicitly exclude apiKey to avoid caching issues with different credentials
    const providerKey = [
      config.provider,
      config.model || 'default',
      config.baseURL || 'default',
      config.timeout?.toString() || 'default',
      config.maxRetries?.toString() || 'default',
    ].join('-');

    // Return cached provider if exists
    if (this.providers.has(providerKey)) {
      return this.providers.get(providerKey)!;
    }

    // Create new provider based on type
    let provider: AIProvider;

    const providerConfig: AIProviderConfig = {
      apiKey: config.apiKey,
      model: config.model,
      baseURL: config.baseURL,
      timeout: config.timeout,
      maxRetries: config.maxRetries,
    };

    switch (config.provider) {
      case 'openai':
        provider = new OpenAIProvider(providerConfig);
        break;

      case 'anthropic':
        provider = new AnthropicProvider(providerConfig);
        break;

      case 'gemini':
        provider = new GeminiProvider(providerConfig);
        break;

      case 'ollama':
        provider = new OllamaProvider(providerConfig);
        break;

      default:
        throw new Error(`Unknown provider type: ${config.provider}`);
    }

    // Cache the provider
    this.providers.set(providerKey, provider);

    return provider;
  }

  /**
   * Create provider from environment variables
   */
  createFromEnv(): AIProvider {
    const providerType = (process.env.AI_PROVIDER || 'openai').toLowerCase() as ProviderType;
    const apiKey = this.getApiKeyFromEnv(providerType);
    const model = process.env.AI_MODEL;
    const baseURL = process.env.AI_BASE_URL;

    if (!apiKey && providerType !== 'ollama') {
      throw new Error(
        `API key not found for provider ${providerType}. Please set the appropriate environment variable.`
      );
    }

    return this.createProvider({
      provider: providerType,
      apiKey: apiKey || 'not-required',
      model,
      baseURL,
    });
  }

  /**
   * Get API key from environment based on provider type
   */
  private getApiKeyFromEnv(provider: ProviderType): string {
    switch (provider) {
      case 'openai':
        return process.env.OPENAI_API_KEY || '';

      case 'anthropic':
        return process.env.ANTHROPIC_API_KEY || '';

      case 'gemini':
        return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

      case 'ollama':
        return 'not-required'; // Ollama doesn't need API key

      default:
        return '';
    }
  }

  /**
   * Get all cached providers
   */
  getCachedProviders(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Clear provider cache
   */
  clearCache(): void {
    this.providers.clear();
  }

  /**
   * Get provider info
   */
  getProviderInfo(provider: ProviderType): {
    name: string;
    models: string[];
    requiresApiKey: boolean;
  } {
    switch (provider) {
      case 'openai':
        return {
          name: 'OpenAI',
          models: OpenAIProvider.getAvailableModels(),
          requiresApiKey: true,
        };

      case 'anthropic':
        return {
          name: 'Anthropic',
          models: AnthropicProvider.getAvailableModels(),
          requiresApiKey: true,
        };

      case 'gemini':
        return {
          name: 'Google Gemini',
          models: GeminiProvider.getAvailableModels(),
          requiresApiKey: true,
        };

      case 'ollama':
        return {
          name: 'Ollama (Local)',
          models: OllamaProvider.getCommonModels(),
          requiresApiKey: false,
        };

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * List all available providers
   */
  static listProviders(): ProviderType[] {
    return ['openai', 'anthropic', 'gemini', 'ollama'];
  }
}

/**
 * Helper function to quickly create a provider
 */
export function createProvider(config: ProviderFactoryConfig): AIProvider {
  const factory = ProviderFactory.getInstance();
  return factory.createProvider(config);
}

/**
 * Helper function to create provider from environment
 */
export function createProviderFromEnv(): AIProvider {
  const factory = ProviderFactory.getInstance();
  return factory.createFromEnv();
}
