/**
 * Anthropic Provider Implementation
 * Supports Claude 3 family models (Opus, Sonnet, Haiku)
 */

import {
  AIProvider,
  AIMessage,
  AIGenerationOptions,
  AIGenerationResult,
  AIProviderConfig,
} from './base.js';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicProvider extends AIProvider {
  private baseURL: string;
  private apiVersion: string;

  constructor(config: AIProviderConfig) {
    super(
      {
        ...config,
        model: config.model || 'claude-sonnet-4-5-20250929',
        baseURL: config.baseURL || 'https://api.anthropic.com/v1',
        timeout: config.timeout || 60000,
        maxRetries: config.maxRetries || 3,
      },
      'Anthropic'
    );
    this.baseURL = this.config.baseURL!;
    this.apiVersion = '2023-06-01';
  }

  async generate(
    messages: AIMessage[],
    options?: AIGenerationOptions
  ): Promise<AIGenerationResult> {
    // Anthropic requires system message to be separate
    const systemMessage = messages.find((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    const anthropicMessages: AnthropicMessage[] = conversationMessages.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    }));

    const requestBody: any = {
      model: this.config.model,
      messages: anthropicMessages,
      max_tokens: options?.maxTokens ?? 2000,
      temperature: options?.temperature ?? 0.7,
      top_p: options?.topP ?? 1,
    };

    if (systemMessage) {
      requestBody.system = systemMessage.content;
    }

    if (options?.stopSequences && options.stopSequences.length > 0) {
      requestBody.stop_sequences = options.stopSequences;
    }

    try {
      const response = await this.makeRequest(requestBody);
      return this.parseResponse(response);
    } catch (error) {
      throw new Error(
        `Anthropic API error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async makeRequest(body: any): Promise<AnthropicResponse> {
    const url = `${this.baseURL}/messages`;
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
            'x-api-key': this.config.apiKey,
            'anthropic-version': this.apiVersion,
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

        return await response.json() as AnthropicResponse;
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
          lastError = new Error('Network error: Unable to reach Anthropic API');
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

    return `Anthropic API error (${status}): ${errorType} - ${errorMessage}`;
  }

  private parseResponse(response: AnthropicResponse): AIGenerationResult {
    const textContent = response.content.find((c) => c.type === 'text');

    if (!textContent) {
      throw new Error('No text content returned from Anthropic');
    }

    return {
      content: textContent.text,
      tokensUsed: {
        prompt: response.usage.input_tokens,
        completion: response.usage.output_tokens,
        total: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: response.stop_reason,
      model: response.model,
    };
  }

  /**
   * List available Anthropic models
   * Note: This list can be overridden via environment variable ANTHROPIC_AVAILABLE_MODELS
   * as a comma-separated string for easier updates without code changes.
   */
  static getAvailableModels(): string[] {
    // Allow environment override for easier updates
    const envModels = process.env.ANTHROPIC_AVAILABLE_MODELS;
    if (envModels) {
      return envModels.split(',').map(m => m.trim()).filter(m => m.length > 0);
    }

    return [
      // Claude 4 Series (Latest)
      'claude-opus-4-1-20250805',
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
      // Claude 3.7 Series
      'claude-3-7-sonnet-20250219',
      // Claude 3.5 Series
      'claude-3-5-haiku-20241022',
      // Claude 3 Series (Legacy)
      'claude-3-haiku-20240307',
      // Note: Claude 3 Opus deprecated June 2025, retiring Jan 2026
    ];
  }
}
