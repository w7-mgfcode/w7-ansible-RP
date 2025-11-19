/**
 * Google Gemini Provider Implementation
 * Supports Gemini Pro and other Google AI models
 */

import {
  AIProvider,
  AIMessage,
  AIGenerationOptions,
  AIGenerationResult,
  AIProviderConfig,
} from './base.js';

interface GeminiContent {
  role: string;
  parts: Array<{ text: string }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
  safetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
      role: string;
    };
    finishReason: string;
    index: number;
    safetyRatings: any[];
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GeminiProvider extends AIProvider {
  private baseURL: string;

  constructor(config: AIProviderConfig) {
    super(
      {
        ...config,
        model: config.model || 'gemini-2.5-flash',
        baseURL: config.baseURL || 'https://generativelanguage.googleapis.com/v1beta',
        timeout: config.timeout || 60000,
        maxRetries: config.maxRetries || 3,
      },
      'Gemini'
    );
    this.baseURL = this.config.baseURL!;
  }

  async generate(
    messages: AIMessage[],
    options?: AIGenerationOptions
  ): Promise<AIGenerationResult> {
    // Gemini combines system and user messages
    const contents = this.convertMessages(messages);

    const requestBody: GeminiRequest = {
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        topP: options?.topP ?? 1,
        maxOutputTokens: options?.maxTokens ?? 2000,
        stopSequences: options?.stopSequences,
      },
      safetySettings: [
        {
          category: 'HARM_CATEGORY_HARASSMENT',
          threshold: 'BLOCK_MEDIUM_AND_ABOVE',
        },
        {
          category: 'HARM_CATEGORY_HATE_SPEECH',
          threshold: 'BLOCK_MEDIUM_AND_ABOVE',
        },
        {
          category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          threshold: 'BLOCK_MEDIUM_AND_ABOVE',
        },
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_MEDIUM_AND_ABOVE',
        },
      ],
    };

    try {
      const response = await this.makeRequest(requestBody);
      return this.parseResponse(response);
    } catch (error) {
      throw new Error(
        `Gemini API error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private convertMessages(messages: AIMessage[]): GeminiContent[] {
    const contents: GeminiContent[] = [];

    // Separate system message from other messages
    const systemMessage = messages.find((m) => m.role === 'system');
    const otherMessages = messages.filter((m) => m.role !== 'system');

    // Handle system message - ensure it's never dropped
    if (systemMessage) {
      if (otherMessages.length > 0 && otherMessages[0] && otherMessages[0].role === 'user') {
        // Prepend system message to first user message
        contents.push({
          role: 'user',
          parts: [{ text: `${systemMessage.content}\n\n${otherMessages[0].content}` }],
        });

        // Add remaining messages
        for (let i = 1; i < otherMessages.length; i++) {
          const msg = otherMessages[i];
          if (msg) {
            contents.push(this.convertMessage(msg));
          }
        }
      } else {
        // First non-system message is not a user message (or no other messages)
        // Create a synthetic user turn containing the system message
        contents.push({
          role: 'user',
          parts: [{ text: systemMessage.content }],
        });

        // Add all other messages
        for (const msg of otherMessages) {
          contents.push(this.convertMessage(msg));
        }
      }
    } else {
      // No system message - just convert all messages
      for (const msg of otherMessages) {
        contents.push(this.convertMessage(msg));
      }
    }

    return contents;
  }

  private convertMessage(message: AIMessage): GeminiContent {
    return {
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    };
  }

  private async makeRequest(body: GeminiRequest): Promise<GeminiResponse> {
    const url = `${this.baseURL}/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;
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

        return await response.json() as GeminiResponse;
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
          lastError = new Error('Network error: Unable to reach Gemini API');
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
    const errorCode = errorData?.error?.code || errorData?.code || 'unknown_error';
    let errorMessage = errorData?.error?.message || errorData?.message || 'Unknown error';

    // Truncate error message to avoid exposing user content
    const maxMessageLength = 200;
    if (errorMessage.length > maxMessageLength) {
      errorMessage = errorMessage.substring(0, maxMessageLength) + '...';
    }

    // Remove any potential user content patterns from error message
    errorMessage = errorMessage.replace(/["'].*?["']/g, '"[redacted]"');

    return `Gemini API error (${status}): ${errorCode} - ${errorMessage}`;
  }

  private parseResponse(response: GeminiResponse): AIGenerationResult {
    const candidate = response.candidates?.[0];

    if (!candidate) {
      throw new Error('No candidates returned from Gemini');
    }

    const text = candidate.content.parts.map((p) => p.text).join('');

    return {
      content: text,
      tokensUsed: response.usageMetadata
        ? {
            prompt: response.usageMetadata.promptTokenCount,
            completion: response.usageMetadata.candidatesTokenCount,
            total: response.usageMetadata.totalTokenCount,
          }
        : undefined,
      finishReason: candidate.finishReason,
      model: this.config.model,
    };
  }

  /**
   * List available Gemini models
   */
  static getAvailableModels(): string[] {
    return [
      // Gemini 3 (Latest - Most Intelligent)
      'gemini-3-pro',
      'gemini-3-deep-think',
      // Gemini 2.5 Series (Stable)
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      // Gemini 2.0 Series
      'gemini-2.0-flash',
      // Legacy Gemini 1.5
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ];
  }
}
