/**
 * Validation and Security Utilities
 * Extracted from server.ts to enable proper unit testing
 */

// =============================================================================
// Path Validation
// =============================================================================

export interface PathValidationResult {
  valid: boolean;
  error?: string;
}

export const DEFAULT_ALLOWED_PATHS = ['/tmp/ansible-mcp', '/workspace/playbooks'];

/**
 * Validate a file path for security concerns
 */
export function validatePath(
  path: string,
  allowedPaths: string[] = DEFAULT_ALLOWED_PATHS
): PathValidationResult {
  // Check for null byte injection
  if (path.includes('\0')) {
    return { valid: false, error: 'Null byte detected in path' };
  }

  // Check for path traversal
  if (path.includes('..')) {
    return { valid: false, error: 'Path traversal attempt detected' };
  }

  // Check if path is within allowed directories
  const isAllowed = allowedPaths.some(allowed => path.startsWith(allowed));
  if (!isAllowed) {
    return { valid: false, error: 'Path outside allowed directories' };
  }

  return { valid: true };
}

// =============================================================================
// Secrets Detection
// =============================================================================

export interface SecretPattern {
  name: string;
  pattern: RegExp;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/gi },
  { name: 'Password', pattern: /password['":\s]*['"]?([^'"}\s]{8,})/gi },
  { name: 'Private Key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/gi },
  { name: 'GitHub Token', pattern: /gh[ps]_[a-zA-Z0-9]{36}/gi },
  { name: 'Generic API Key', pattern: /api[_-]?key['":\s]*['"]?([a-zA-Z0-9]{20,})/gi },
  { name: 'JWT Token', pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/gi },
];

export interface SecretsDetectionResult {
  hasSecrets: boolean;
  detectedSecrets: string[];
}

/**
 * Detect hardcoded secrets in content
 */
export function detectSecrets(content: string): SecretsDetectionResult {
  const detectedSecrets: string[] = [];

  // Skip Jinja2 template variables
  const contentWithoutJinja = content.replace(/\{\{[^}]+\}\}/g, '');

  for (const { name, pattern } of SECRET_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;
    if (pattern.test(contentWithoutJinja)) {
      detectedSecrets.push(name);
    }
  }

  return {
    hasSecrets: detectedSecrets.length > 0,
    detectedSecrets,
  };
}

/**
 * Check if content is a Jinja2 template variable
 */
export function isJinjaVariable(content: string): boolean {
  return content.includes('{{ ') && content.includes(' }}');
}

// =============================================================================
// Input Sanitization
// =============================================================================

/**
 * Sanitize tags to prevent command injection
 */
export function sanitizeTags(tags: string[]): string[] {
  return tags
    .map(tag => tag.replace(/[^a-zA-Z0-9_-]/g, ''))
    .filter(tag => tag.length > 0);
}

/**
 * Validate playbook content size
 */
export function validatePlaybookSize(
  content: string,
  maxSize: number = 1024 * 1024
): { valid: boolean; error?: string } {
  if (content.length > maxSize) {
    return {
      valid: false,
      error: `Playbook exceeds maximum size of ${maxSize} bytes`
    };
  }
  return { valid: true };
}

// =============================================================================
// Rate Limiting
// =============================================================================

export class RateLimiter {
  private requestMap: Map<string, number[]> = new Map();
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  /**
   * Check if request should be allowed
   */
  checkLimit(clientId: string): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const requests = this.requestMap.get(clientId) || [];

    // Filter to recent requests within window
    const recentRequests = requests.filter(time => now - time < this.windowMs);

    // Update map with cleaned requests
    this.requestMap.set(clientId, recentRequests);

    const remaining = this.maxRequests - recentRequests.length;

    if (recentRequests.length >= this.maxRequests) {
      return { allowed: false, remaining: 0 };
    }

    // Add this request
    recentRequests.push(now);
    this.requestMap.set(clientId, recentRequests);

    return { allowed: true, remaining: remaining - 1 };
  }

  /**
   * Get current request count for a client
   */
  getRequestCount(clientId: string): number {
    const now = Date.now();
    const requests = this.requestMap.get(clientId) || [];
    return requests.filter(time => now - time < this.windowMs).length;
  }

  /**
   * Clear all rate limit data
   */
  clear(): void {
    this.requestMap.clear();
  }
}

// =============================================================================
// Best Practices Validation
// =============================================================================

export interface BestPracticesResult {
  warnings: string[];
}

/**
 * Check playbook for best practices
 */
export function checkBestPractices(content: string): BestPracticesResult {
  const warnings: string[] = [];

  // Check for become directive
  if (!content.includes('become:') && !content.includes('become_user:')) {
    warnings.push('Consider adding become directive for privilege escalation');
  }

  // Check for tags
  if (!content.includes('tags:')) {
    warnings.push('Consider adding tags for selective task execution');
  }

  // Check for handlers when notify is used
  if (content.includes('notify:') && !content.includes('handlers:')) {
    warnings.push('Playbook has notify but no handlers section defined');
  }

  // Check for deprecated modules
  const deprecatedModules = ['apt_key', 'apt_repository'];
  for (const module of deprecatedModules) {
    if (content.includes(`${module}:`)) {
      warnings.push(`Module '${module}' is deprecated. Consider using alternatives.`);
    }
  }

  return { warnings };
}

// =============================================================================
// Retry Logic
// =============================================================================

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
};

/**
 * Calculate exponential backoff delay
 */
export function calculateBackoff(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const delay = config.baseDelayMs * Math.pow(2, attempt - 1);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Execute operation with retry logic
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < config.maxRetries) {
        const delay = calculateBackoff(attempt, config);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Operation failed after retries');
}

// =============================================================================
// Metrics Configuration
// =============================================================================

export const METRIC_NAMES = {
  playbooksGenerated: 'ansible_mcp_playbooks_generated_total',
  playbooksExecuted: 'ansible_mcp_playbooks_executed_total',
  validationErrors: 'ansible_mcp_validation_errors_total',
  executionDuration: 'ansible_mcp_execution_duration_seconds',
  secretsDetected: 'ansible_mcp_secrets_detected_total',
  authFailures: 'ansible_mcp_auth_failures_total',
  activeConnections: 'ansible_mcp_active_connections',
} as const;

export const HISTOGRAM_BUCKETS = [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300];

/**
 * Validate metric name follows Prometheus conventions
 */
export function isValidMetricName(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name);
}
