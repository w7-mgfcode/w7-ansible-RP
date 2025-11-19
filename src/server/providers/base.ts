/**
 * Base AI Provider Interface
 * Defines the contract for all AI providers
 */

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIGenerationOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  stream?: boolean;
}

export interface AIGenerationResult {
  content: string;
  tokensUsed?: {
    prompt: number;
    completion: number;
    total: number;
  };
  finishReason?: string;
  model?: string;
}

export interface AIProviderConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

/**
 * Abstract base class for AI providers
 */
export abstract class AIProvider {
  protected config: AIProviderConfig;
  protected providerName: string;

  constructor(config: AIProviderConfig, providerName: string) {
    this.config = config;
    this.providerName = providerName;
    this.validateConfig();
  }

  /**
   * Validate provider configuration
   */
  protected validateConfig(): void {
    if (!this.config.apiKey) {
      throw new Error(`${this.providerName}: API key is required`);
    }
  }

  /**
   * Generate a completion from the AI model
   */
  abstract generate(
    messages: AIMessage[],
    options?: AIGenerationOptions
  ): Promise<AIGenerationResult>;

  /**
   * Generate a playbook using the AI model
   */
  async generatePlaybook(
    prompt: string,
    context?: any,
    options?: AIGenerationOptions
  ): Promise<string> {
    const systemMessage: AIMessage = {
      role: 'system',
      content: this.getSystemPrompt(context),
    };

    const userMessage: AIMessage = {
      role: 'user',
      content: this.formatPlaybookPrompt(prompt, context),
    };

    const result = await this.generate([systemMessage, userMessage], {
      ...options,
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens ?? 2000,
    });

    return result.content;
  }

  /**
   * Get the system prompt for playbook generation
   */
  protected getSystemPrompt(context?: any): string {
    return `You are an expert Ansible playbook generator. Your task is to create production-ready,
well-structured Ansible playbooks based on user requirements.

Guidelines:
- Generate valid YAML syntax
- Follow Ansible best practices
- Include proper task names and tags
- Add appropriate error handling
- Use variables with sensible defaults
- Include comments for complex logic
- Ensure idempotency
- Add handlers when needed
${context?.environment ? `- Target environment: ${context.environment}` : ''}
${context?.requirements ? `- Special requirements: ${context.requirements.join(', ')}` : ''}

Output ONLY the YAML playbook content, no explanations or markdown formatting.`;
  }

  /**
   * Format the user prompt for playbook generation
   */
  protected formatPlaybookPrompt(prompt: string, context?: any): string {
    let formattedPrompt = `Generate an Ansible playbook for: ${prompt}\n`;

    if (context?.target_hosts) {
      formattedPrompt += `\nTarget hosts: ${context.target_hosts}`;
    }

    if (context?.environment) {
      formattedPrompt += `\nEnvironment: ${context.environment}`;
    }

    if (context?.tags && context.tags.length > 0) {
      formattedPrompt += `\nTags to include: ${context.tags.join(', ')}`;
    }

    if (context?.variables) {
      formattedPrompt += `\nVariables: ${JSON.stringify(context.variables, null, 2)}`;
    }

    return formattedPrompt;
  }

  /**
   * Get provider name
   */
  getName(): string {
    return this.providerName;
  }

  /**
   * Get current model
   */
  getModel(): string {
    return this.config.model || 'default';
  }

  /**
   * Test provider connection
   */
  async test(): Promise<boolean> {
    try {
      const result = await this.generate(
        [
          {
            role: 'user',
            content: 'Respond with "OK" if you can read this message.',
          },
        ],
        { maxTokens: 10 }
      );
      return result.content.toLowerCase().includes('ok');
    } catch (error) {
      console.error(`${this.providerName} test failed:`, error);
      return false;
    }
  }
}
