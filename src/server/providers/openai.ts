/**
 * OpenAI Provider Implementation
 * Supports GPT-4, GPT-3.5-turbo, and other OpenAI models
 */

import {
  AIProvider,
  AIMessage,
  AIGenerationOptions,
  AIGenerationResult,
  AIProviderConfig,
} from './base.js';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Models that should use the Responses API (/v1/responses)
const RESPONSES_API_MODELS = [
  'gpt-5',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'o4-mini',
  'o3-pro',
  'o3-mini',
  'o3',
  'o1',
];

// Models that use the legacy Chat Completions API (/v1/chat/completions)
// These are selected by exclusion from RESPONSES_API_MODELS:
// - gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-4, gpt-3.5-turbo

export class OpenAIProvider extends AIProvider {
  private baseURL: string;

  constructor(config: AIProviderConfig) {
    super(
      {
        ...config,
        model: config.model || 'gpt-4.1',
        baseURL: config.baseURL || 'https://api.openai.com/v1',
        timeout: config.timeout || 60000,
        maxRetries: config.maxRetries || 3,
      },
      'OpenAI'
    );
    this.baseURL = this.config.baseURL!;
  }

  /**
   * Check if a model should use the Responses API
   */
  private usesResponsesAPI(model: string): boolean {
    return RESPONSES_API_MODELS.some(m => model.startsWith(m));
  }

  async generate(
    messages: AIMessage[],
    options?: AIGenerationOptions
  ): Promise<AIGenerationResult> {
    const openAIMessages: OpenAIMessage[] = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const requestBody = {
      model: this.config.model,
      messages: openAIMessages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2000,
      top_p: options?.topP ?? 1,
      stop: options?.stopSequences,
      // Streaming is not currently supported - would require SSE response handling
      // TODO: Implement streaming support with options?.stream when needed
      stream: false,
    };

    try {
      const response = await this.makeRequest(requestBody);
      return this.parseResponse(response);
    } catch (error) {
      throw new Error(`OpenAI API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async makeRequest(body: any): Promise<OpenAIResponse> {
    // Route to appropriate endpoint based on model
    const model = body.model || this.config.model || '';
    const endpoint = this.usesResponsesAPI(model) ? '/responses' : '/chat/completions';
    const url = `${this.baseURL}${endpoint}`;
    const maxRetries = this.config.maxRetries || 3;
    const timeout = this.config.timeout || 60000;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Apply backoff for retries (0, 1s, 2s, 4s...)
      if (attempt > 0) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }

      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const sanitizedError = this.sanitizeErrorResponse(response.status, errorData);

          // Retry on transient errors (429, 500, 502, 503, 504)
          if ([429, 500, 502, 503, 504].includes(response.status) && attempt < maxRetries - 1) {
            lastError = new Error(sanitizedError);
            continue;
          }

          throw new Error(sanitizedError);
        }

        return await response.json() as OpenAIResponse;
      } catch (error) {
        clearTimeout(timeoutId);

        // Handle timeout/abort errors
        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
          if (attempt < maxRetries - 1) {
            continue;
          }
          throw lastError;
        }

        // Handle network errors (retry)
        if (error instanceof TypeError && error.message.includes('fetch')) {
          lastError = new Error('Network error: Unable to reach OpenAI API');
          if (attempt < maxRetries - 1) {
            continue;
          }
          throw lastError;
        }

        throw error;
      }
    }

    throw lastError || new Error('Request failed after maximum retries');
  }

  /**
   * Sanitize error response to avoid exposing sensitive data
   */
  private sanitizeErrorResponse(status: number, errorData: any): string {
    // Extract only safe, high-level error fields
    const errorType = errorData?.error?.type || errorData?.type || 'unknown_error';
    let errorMessage = errorData?.error?.message || errorData?.message || 'Unknown error';

    // Truncate error message to avoid exposing user content
    const maxMessageLength = 200;
    if (errorMessage.length > maxMessageLength) {
      errorMessage = errorMessage.substring(0, maxMessageLength) + '...';
    }

    // Remove any potential user content patterns from error message
    errorMessage = errorMessage.replace(/["'].*?["']/g, '"[redacted]"');

    return `OpenAI API error (${status}): ${errorType} - ${errorMessage}`;
  }

  private parseResponse(response: OpenAIResponse): AIGenerationResult {
    const choice = response.choices[0];

    if (!choice) {
      throw new Error('No completion choices returned from OpenAI');
    }

    return {
      content: choice.message.content,
      tokensUsed: {
        prompt: response.usage.prompt_tokens,
        completion: response.usage.completion_tokens,
        total: response.usage.total_tokens,
      },
      finishReason: choice.finish_reason,
      model: response.model,
    };
  }

  /**
   * List available OpenAI models
   * Note: This list can be overridden via environment variable OPENAI_AVAILABLE_MODELS
   * as a comma-separated string for easier updates without code changes.
   */
  static getAvailableModels(): string[] {
    // Allow environment override for easier updates
    const envModels = process.env.OPENAI_AVAILABLE_MODELS;
    if (envModels) {
      return envModels.split(',').map(m => m.trim()).filter(m => m.length > 0);
    }

    return [
      // GPT-5 (Latest flagship)
      'gpt-5',
      // GPT-4.1 Series (Recommended)
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
      // Reasoning Models (o-series)
      'o4-mini',
      'o3-pro',
      'o3-mini',
      'o3',
      'o1',
      // GPT-4o Series
      'gpt-4o',
      'gpt-4o-mini',
      // Legacy GPT-4
      'gpt-4-turbo',
      'gpt-4',
      // Legacy GPT-3.5
      'gpt-3.5-turbo',
    ];
  }
}
