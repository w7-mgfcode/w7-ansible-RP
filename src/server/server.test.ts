/**
 * Unit tests for Ansible MCP Server
 * Tests security features, validation, and core functionality
 */

import { describe, test, expect, jest } from '@jest/globals';

// Import actual production code for testing
import {
  validatePath,
  DEFAULT_ALLOWED_PATHS,
  detectSecrets,
  isJinjaVariable,
  sanitizeTags,
  validatePlaybookSize,
  RateLimiter,
  checkBestPractices,
  calculateBackoff,
  withRetry,
  DEFAULT_RETRY_CONFIG,
  METRIC_NAMES,
  HISTOGRAM_BUCKETS,
  isValidMetricName,
} from './validation.js';

// Mock external dependencies
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('PONG'),
    get: jest.fn<() => Promise<string | null>>().mockResolvedValue(null),
    setex: jest.fn<() => Promise<string>>().mockResolvedValue('OK'),
    quit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }));
});

jest.mock('node-vault', () => {
  return jest.fn().mockImplementation(() => ({
    health: jest.fn<() => Promise<{ initialized: boolean }>>().mockResolvedValue({ initialized: true }),
    read: jest.fn<() => Promise<{ data: { key: string } }>>().mockResolvedValue({ data: { key: 'value' } }),
  }));
});

// =============================================================================
// Security Tests
// =============================================================================

describe('Security Features', () => {
  describe('Path Validation', () => {
    test('should reject path traversal attempts with ../', () => {
      const result = validatePath('/tmp/ansible-mcp/../../../etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    test('should reject paths outside allowed directories', () => {
      const result = validatePath('/etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('outside allowed');
    });

    test('should accept paths within allowed directories', () => {
      const result = validatePath('/tmp/ansible-mcp/playbook_123.yml');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('should reject null byte injection', () => {
      const result = validatePath('/tmp/ansible-mcp/file\0.yml');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Null byte');
    });

    test('should use default allowed paths', () => {
      expect(DEFAULT_ALLOWED_PATHS).toContain('/tmp/ansible-mcp');
      expect(DEFAULT_ALLOWED_PATHS).toContain('/workspace/playbooks');
    });
  });

  describe('Secrets Detection', () => {
    test('should detect AWS access keys', () => {
      const result = detectSecrets('aws_access_key_id: AKIAIOSFODNN7EXAMPLE');
      expect(result.hasSecrets).toBe(true);
      expect(result.detectedSecrets).toContain('AWS Access Key');
    });

    test('should detect hardcoded passwords', () => {
      const result = detectSecrets('password: "supersecretpassword123"');
      expect(result.hasSecrets).toBe(true);
      expect(result.detectedSecrets).toContain('Password');
    });

    test('should detect private keys', () => {
      const result = detectSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIEpA...');
      expect(result.hasSecrets).toBe(true);
      expect(result.detectedSecrets).toContain('Private Key');
    });

    test('should detect GitHub tokens', () => {
      const result = detectSecrets('github_token: ghp_1234567890abcdefghijklmnopqrstuvwxyz');
      expect(result.hasSecrets).toBe(true);
      expect(result.detectedSecrets).toContain('GitHub Token');
    });

    test('should not flag Jinja2 variables as secrets', () => {
      const content = 'password: "{{ vault_password }}"';
      expect(isJinjaVariable(content)).toBe(true);
      // detectSecrets should skip Jinja variables
      const result = detectSecrets(content);
      expect(result.hasSecrets).toBe(false);
    });

    test('should not flag safe content', () => {
      const content = `
        - name: Install package
          package:
            name: nginx
            state: present
      `;
      const result = detectSecrets(content);
      expect(result.hasSecrets).toBe(false);
      expect(result.detectedSecrets).toHaveLength(0);
    });
  });

  describe('Rate Limiting', () => {
    test('should allow requests within rate limit', () => {
      const limiter = new RateLimiter(60000, 100);
      const clientId = 'test-client';

      // Make 50 requests - should all be allowed
      for (let i = 0; i < 50; i++) {
        const result = limiter.checkLimit(clientId);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBeGreaterThanOrEqual(0);
      }

      expect(limiter.getRequestCount(clientId)).toBe(50);
    });

    test('should block requests exceeding rate limit', () => {
      const limiter = new RateLimiter(60000, 10);
      const clientId = 'test-client';

      // Make 10 requests to hit the limit
      for (let i = 0; i < 10; i++) {
        const result = limiter.checkLimit(clientId);
        expect(result.allowed).toBe(true);
      }

      // 11th request should be blocked
      const result = limiter.checkLimit(clientId);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    test('should clear rate limit data', () => {
      const limiter = new RateLimiter(60000, 10);
      const clientId = 'test-client';

      limiter.checkLimit(clientId);
      expect(limiter.getRequestCount(clientId)).toBe(1);

      limiter.clear();
      expect(limiter.getRequestCount(clientId)).toBe(0);
    });
  });
});

// =============================================================================
// Input Validation Tests
// =============================================================================

describe('Input Validation', () => {
  describe('Tag Sanitization', () => {
    test('should sanitize tags to prevent injection', () => {
      const maliciousTags = ['deploy; rm -rf /', 'test$(whoami)', 'prod`id`'];
      const sanitizedTags = sanitizeTags(maliciousTags);
      expect(sanitizedTags).toEqual(['deployrm-rf', 'testwhoami', 'prodid']);
    });

    test('should allow valid tags', () => {
      const validTags = ['deploy', 'production', 'web-server', 'app_v2'];
      const sanitizedTags = sanitizeTags(validTags);
      expect(sanitizedTags).toEqual(validTags);
    });

    test('should filter empty tags', () => {
      const tagsWithEmpty = ['valid', '!!!', '', 'also-valid'];
      const sanitizedTags = sanitizeTags(tagsWithEmpty);
      expect(sanitizedTags).toEqual(['valid', 'also-valid']);
    });
  });

  describe('Playbook Size Validation', () => {
    test('should reject oversized playbooks', () => {
      const oversizedContent = 'x'.repeat(1024 * 1024 + 1);
      const result = validatePlaybookSize(oversizedContent);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds maximum');
    });

    test('should accept normal-sized playbooks', () => {
      const normalContent = `
        ---
        - name: Test Playbook
          hosts: all
          tasks:
            - name: Test task
              debug:
                msg: "Hello World"
      `;
      const result = validatePlaybookSize(normalContent);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('should use custom max size', () => {
      const content = 'x'.repeat(100);
      const result = validatePlaybookSize(content, 50);
      expect(result.valid).toBe(false);
    });
  });
});

// =============================================================================
// YAML Validation Tests
// =============================================================================

describe('YAML Validation', () => {
  test('should validate correct YAML syntax', () => {
    const validYaml = `
---
- name: Valid Playbook
  hosts: all
  tasks:
    - name: Test task
      debug:
        msg: "Hello"
`;

    // Import yaml and test
    const yaml = require('js-yaml');
    expect(() => yaml.load(validYaml)).not.toThrow();
  });

  test('should detect invalid YAML syntax', () => {
    const invalidYaml = `
---
- name: Invalid Playbook
  hosts: all
  tasks:
    - name: Bad indentation
     debug:  # Wrong indentation
        msg: "Hello"
`;

    const yaml = require('js-yaml');
    expect(() => yaml.load(invalidYaml)).toThrow();
  });
});

// =============================================================================
// Best Practices Check Tests
// =============================================================================

describe('Best Practices Validation', () => {
  test('should warn about missing become directive', () => {
    const content = `
      - name: Playbook without become
        hosts: all
        tasks:
          - name: Install package
            package:
              name: nginx
    `;

    const result = checkBestPractices(content);
    expect(result.warnings.some(w => w.includes('become'))).toBe(true);
  });

  test('should warn about missing tags', () => {
    const content = `
      - name: Playbook without tags
        hosts: all
        tasks:
          - name: Install package
            package:
              name: nginx
    `;

    const result = checkBestPractices(content);
    expect(result.warnings.some(w => w.includes('tags'))).toBe(true);
  });

  test('should detect undefined handlers', () => {
    const content = `
      - name: Playbook with notify but no handlers
        hosts: all
        tasks:
          - name: Update config
            copy:
              src: file
              dest: /etc/file
            notify: restart service
    `;

    const result = checkBestPractices(content);
    expect(result.warnings.some(w => w.includes('handlers'))).toBe(true);
  });

  test('should not warn for well-formed playbooks', () => {
    const content = `
      - name: Good Playbook
        hosts: all
        become: yes
        tasks:
          - name: Install package
            package:
              name: nginx
            tags:
              - install
        handlers:
          - name: restart service
            service:
              name: nginx
              state: restarted
    `;

    const result = checkBestPractices(content);
    // May have fewer warnings for well-formed playbooks
    expect(result.warnings.some(w => w.includes('become'))).toBe(false);
    expect(result.warnings.some(w => w.includes('tags'))).toBe(false);
  });
});

// =============================================================================
// Retry Logic Tests
// =============================================================================

describe('Retry Logic', () => {
  test('should implement exponential backoff', () => {
    const delays = [1, 2, 3].map(attempt => calculateBackoff(attempt));
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  test('should cap backoff at max delay', () => {
    const delay = calculateBackoff(10, { ...DEFAULT_RETRY_CONFIG, maxDelayMs: 5000 });
    expect(delay).toBe(5000);
  });

  test('should use custom retry config', () => {
    const delay = calculateBackoff(1, { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 4000 });
    expect(delay).toBe(500);
  });

  test('should respect max retries with withRetry', async () => {
    let attempts = 0;

    const operation = async () => {
      attempts++;
      throw new Error('Simulated failure');
    };

    await expect(withRetry(operation, {
      maxRetries: 3,
      baseDelayMs: 10, // Use short delay for tests
      maxDelayMs: 50,
    })).rejects.toThrow('Simulated failure');

    expect(attempts).toBe(3);
  });

  test('should succeed on retry', async () => {
    let attempts = 0;

    const operation = async () => {
      attempts++;
      if (attempts < 2) {
        throw new Error('Temporary failure');
      }
      return 'success';
    };

    const result = await withRetry(operation, {
      maxRetries: 3,
      baseDelayMs: 10,
      maxDelayMs: 50,
    });

    expect(result).toBe('success');
    expect(attempts).toBe(2);
  });
});

// =============================================================================
// Metrics Tests
// =============================================================================

describe('Metrics', () => {
  test('should have correct metric names', () => {
    // Test actual production metric names
    const metricNames = Object.values(METRIC_NAMES);

    expect(metricNames).toContain('ansible_mcp_playbooks_generated_total');
    expect(metricNames).toContain('ansible_mcp_playbooks_executed_total');
    expect(metricNames).toContain('ansible_mcp_validation_errors_total');
    expect(metricNames).toContain('ansible_mcp_execution_duration_seconds');

    // Verify all metric names follow Prometheus naming conventions
    metricNames.forEach(name => {
      expect(isValidMetricName(name)).toBe(true);
      expect(name).toContain('ansible_mcp');
    });
  });

  test('should have appropriate histogram buckets', () => {
    // Test actual production histogram buckets
    const buckets = HISTOGRAM_BUCKETS;

    // Verify buckets are in ascending order
    for (let i = 1; i < buckets.length; i++) {
      const current = buckets[i];
      const previous = buckets[i - 1];
      if (current !== undefined && previous !== undefined) {
        expect(current).toBeGreaterThan(previous);
      }
    }

    // Verify reasonable range for playbook execution
    const firstBucket = buckets[0];
    const lastBucket = buckets[buckets.length - 1];
    if (firstBucket !== undefined) {
      expect(firstBucket).toBeLessThanOrEqual(1);
    }
    if (lastBucket !== undefined) {
      expect(lastBucket).toBeGreaterThanOrEqual(60);
    }
  });

  test('should validate metric name format', () => {
    expect(isValidMetricName('ansible_mcp_test')).toBe(true);
    expect(isValidMetricName('valid123_name')).toBe(true);
    expect(isValidMetricName('Invalid-Name')).toBe(false);
    expect(isValidMetricName('123starts_with_number')).toBe(false);
  });
});

// =============================================================================
// Integration Test Helpers
// =============================================================================

describe('Test Utilities', () => {
  test('should create test playbook content', () => {
    const createTestPlaybook = (name: string, hosts: string = 'all') => {
      return `---
- name: ${name}
  hosts: ${hosts}
  become: yes
  tasks:
    - name: Test task
      debug:
        msg: "Test playbook"
      tags:
        - test
`;
    };

    const playbook = createTestPlaybook('Test Playbook');
    expect(playbook).toContain('name: Test Playbook');
    expect(playbook).toContain('hosts: all');
    expect(playbook).toContain('become: yes');
    expect(playbook).toContain('tags:');
  });
});
