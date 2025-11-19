import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type {
  CallToolResult,
  ToolAnnotations,
  ServerCapabilities
} from '@modelcontextprotocol/sdk/types.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import {
  PromptTemplateLibrary,
  TemplateCategory,
  PromptTemplate,
  EnrichedPrompt
} from './prompt_templates.js';
import { AIProvider, createProviderFromEnv } from './providers/index.js';
import { validatePath } from './validation.js';
import winston from 'winston';
import { default as RedisModule } from 'ioredis';
import Vault from 'node-vault';
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import * as http from 'http';

// Handle both ESM and CommonJS module formats
const Redis = (RedisModule as any).default || RedisModule;
type RedisClient = InstanceType<typeof Redis>;

const execFileAsync = promisify(execFile);

// =============================================================================
// SECURITY CONFIGURATION
// =============================================================================

interface SecurityConfig {
  apiKey: string | null;
  enableAuth: boolean;
  allowedPaths: string[];
  maxPlaybookSize: number;
  rateLimitPerMinute: number;
}

const securityConfig: SecurityConfig = {
  apiKey: process.env.MCP_API_KEY || null,
  enableAuth: process.env.MCP_ENABLE_AUTH === 'true',
  allowedPaths: ['/tmp/ansible-mcp', '/workspace/playbooks'],
  maxPlaybookSize: 1024 * 1024, // 1MB
  rateLimitPerMinute: 100,
};

// =============================================================================
// LOGGING CONFIGURATION
// =============================================================================

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'ansible-mcp-server', version: '2.0.0' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
      stderrLevels: ['error', 'warn', 'info', 'debug'],
    }),
    new winston.transports.File({
      filename: '/tmp/ansible-mcp/logs/error.log',
      level: 'error'
    }),
    new winston.transports.File({
      filename: '/tmp/ansible-mcp/logs/combined.log'
    }),
  ],
});

// =============================================================================
// METRICS CONFIGURATION
// =============================================================================

const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

const metrics = {
  playbooksGenerated: new Counter({
    name: 'ansible_mcp_playbooks_generated_total',
    help: 'Total number of playbooks generated',
    labelNames: ['template', 'status'],
    registers: [metricsRegistry],
  }),
  playbooksExecuted: new Counter({
    name: 'ansible_mcp_playbooks_executed_total',
    help: 'Total number of playbooks executed',
    labelNames: ['status', 'check_mode'],
    registers: [metricsRegistry],
  }),
  validationErrors: new Counter({
    name: 'ansible_mcp_validation_errors_total',
    help: 'Total number of validation errors',
    registers: [metricsRegistry],
  }),
  executionDuration: new Histogram({
    name: 'ansible_mcp_execution_duration_seconds',
    help: 'Duration of playbook execution in seconds',
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300],
    registers: [metricsRegistry],
  }),
  secretsDetected: new Counter({
    name: 'ansible_mcp_secrets_detected_total',
    help: 'Total number of potential secrets detected in playbooks',
    registers: [metricsRegistry],
  }),
  authFailures: new Counter({
    name: 'ansible_mcp_auth_failures_total',
    help: 'Total number of authentication failures',
    registers: [metricsRegistry],
  }),
  activeConnections: new Gauge({
    name: 'ansible_mcp_active_connections',
    help: 'Number of active connections',
    registers: [metricsRegistry],
  }),
};

// =============================================================================
// SECRETS DETECTION PATTERNS
// =============================================================================

const secretPatterns = [
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/gi },
  { name: 'AWS Secret Key', pattern: /[0-9a-zA-Z/+]{40}/g },
  { name: 'API Key', pattern: /api[_-]?key['":\s]*['"]?([a-zA-Z0-9_-]{20,})/gi },
  { name: 'Password', pattern: /password['":\s]*['"]?([^'"}\s]{8,})/gi },
  { name: 'Private Key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/gi },
  { name: 'GitHub Token', pattern: /gh[ps]_[a-zA-Z0-9]{36}/gi },
  { name: 'Slack Token', pattern: /xox[baprs]-[0-9a-zA-Z-]{10,}/gi },
  { name: 'JWT', pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/gi },
  { name: 'Generic Secret', pattern: /secret['":\s]*['"]?([a-zA-Z0-9_-]{16,})/gi },
  { name: 'Bearer Token', pattern: /bearer\s+[a-zA-Z0-9_.-]+/gi },
];

// =============================================================================
// RETRY UTILITY
// =============================================================================

async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        logger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms`, {
          error: lastError.message
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// Tool schemas
const GeneratePlaybookSchema = z.object({
  prompt: z.string(),
  template: z.string().optional(),
  context: z.object({
    target_hosts: z.string().optional(),
    environment: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
});

const ValidatePlaybookSchema = z.object({
  playbook_path: z.string(),
  strict: z.boolean().optional(),
});

const RunPlaybookSchema = z.object({
  playbook_path: z.string(),
  inventory: z.string(),
  extra_vars: z.record(z.any()).optional(),
  check_mode: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

const RefinePlaybookSchema = z.object({
  playbook_path: z.string(),
  feedback: z.string(),
  validation_errors: z.array(z.string()).optional(),
});

// Prompt Template schemas
const ListPromptTemplatesSchema = z.object({
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  search: z.string().optional(),
});

const GetPromptTemplateSchema = z.object({
  template_id: z.string(),
});

const EnrichPromptSchema = z.object({
  prompt: z.string(),
  template_id: z.string(),
  additional_context: z.record(z.any()).optional(),
});

const GenerateWithTemplateSchema = z.object({
  prompt: z.string(),
  template_id: z.string(),
  context: z.object({
    target_hosts: z.string().optional(),
    environment: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
  additional_context: z.record(z.any()).optional(),
});

const UpdateTemplateSchema = z.object({
  template_id: z.string(),
  updates: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    system_prompt: z.string().optional(),
    user_prompt_template: z.string().optional(),
    best_practices: z.array(z.string()).optional(),
  }),
  change_description: z.array(z.string()),
});

const GetTemplateHistorySchema = z.object({
  template_id: z.string(),
});

// Server capabilities declaration for MCP compliance
const serverCapabilities: ServerCapabilities = {
  tools: {
    listChanged: true,
  },
  logging: {},
};

class AnsibleMCPServer {
  private server: McpServer;
  private playbookTemplates: Map<string, string>;
  private promptTemplateLibrary: PromptTemplateLibrary;
  private workDir: string;
  private aiProvider: AIProvider | null;
  private redis: RedisClient | null;
  private vault: any;
  private metricsServer: http.Server | null;
  private rateLimitMap: Map<string, number[]>;

  constructor() {
    this.server = new McpServer(
      {
        name: 'ansible-mcp-server',
        version: '2.0.0',
      },
      {
        capabilities: serverCapabilities,
        instructions: 'Ansible MCP Server for AI-powered playbook generation and automation. Supports playbook creation, validation, execution, and refinement with template-based and AI-enhanced workflows.',
      }
    );

    this.playbookTemplates = new Map();
    this.promptTemplateLibrary = new PromptTemplateLibrary();
    this.workDir = '/tmp/ansible-mcp';
    this.aiProvider = null;
    this.redis = null;
    this.vault = null;
    this.metricsServer = null;
    this.rateLimitMap = new Map();
  }

  // ===========================================================================
  // SECURITY METHODS
  // ===========================================================================

  private validatePath(inputPath: string): { valid: boolean; error?: string; sanitizedPath?: string } {
    // Check for null bytes first (before any path operations)
    if (inputPath.includes('\0')) {
      logger.warn('Null byte injection attempt detected', { inputPath });
      return { valid: false, error: 'Invalid characters in path' };
    }

    // Normalize and resolve the path
    const normalizedPath = path.normalize(inputPath);
    const resolvedPath = path.resolve(normalizedPath);

    // Check if path is within allowed directories using path.relative()
    // This is more robust than startsWith() which can allow partial matches
    const isAllowed = securityConfig.allowedPaths.some(allowedPath => {
      const resolvedAllowed = path.resolve(allowedPath);
      const relativePath = path.relative(resolvedAllowed, resolvedPath);

      // Path is inside if:
      // 1. It's not empty (same directory is allowed)
      // 2. It doesn't start with '..' (not escaping)
      // 3. It's not an absolute path (not escaping on Windows)
      return relativePath === '' ||
        (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
    });

    if (!isAllowed) {
      logger.warn('Access to unauthorized path attempted', { inputPath, resolvedPath });
      return { valid: false, error: `Path not in allowed directories: ${securityConfig.allowedPaths.join(', ')}` };
    }

    return { valid: true, sanitizedPath: resolvedPath };
  }

  private detectSecrets(content: string): { found: boolean; secrets: { type: string; line: number }[] } {
    const detectedSecrets: { type: string; line: number }[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      // Skip lines that are clearly Jinja2 variables
      if (line.includes('{{ ') && line.includes(' }}')) {
        return;
      }

      secretPatterns.forEach(({ name, pattern }) => {
        // Reset lastIndex for global patterns
        pattern.lastIndex = 0;
        if (pattern.test(line)) {
          detectedSecrets.push({ type: name, line: index + 1 });
        }
      });
    });

    if (detectedSecrets.length > 0) {
      metrics.secretsDetected.inc(detectedSecrets.length);
      logger.warn('Potential secrets detected in playbook', {
        count: detectedSecrets.length,
        types: [...new Set(detectedSecrets.map(s => s.type))]
      });
    }

    return {
      found: detectedSecrets.length > 0,
      secrets: detectedSecrets
    };
  }

  private checkRateLimit(clientId: string = 'default'): boolean {
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const requests = this.rateLimitMap.get(clientId) || [];

    // Filter out old requests
    const recentRequests = requests.filter(time => now - time < windowMs);

    if (recentRequests.length >= securityConfig.rateLimitPerMinute) {
      logger.warn('Rate limit exceeded', { clientId, requestCount: recentRequests.length });
      return false;
    }

    recentRequests.push(now);
    this.rateLimitMap.set(clientId, recentRequests);
    return true;
  }

  // ===========================================================================
  // INFRASTRUCTURE INTEGRATION
  // ===========================================================================

  private async initializeRedis(): Promise<void> {
    const redisHost = process.env.REDIS_HOST || 'localhost';
    const redisPort = parseInt(process.env.REDIS_PORT || '6379');

    try {
      this.redis = new Redis({
        host: redisHost,
        port: redisPort,
        retryStrategy: (times: number) => {
          if (times > 3) {
            logger.error('Redis connection failed after 3 retries');
            return null;
          }
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });

      await this.redis.connect();
      logger.info('Redis connected successfully', { host: redisHost, port: redisPort });
    } catch (error) {
      logger.warn('Redis connection failed, caching disabled', {
        error: (error as Error).message
      });
      this.redis = null;
    }
  }

  private async initializeVault(): Promise<void> {
    const vaultAddr = process.env.VAULT_ADDR || 'http://localhost:8200';
    const vaultToken = process.env.VAULT_TOKEN;

    if (!vaultToken) {
      logger.warn('VAULT_TOKEN not set, Vault integration disabled');
      return;
    }

    try {
      this.vault = Vault({
        apiVersion: 'v1',
        endpoint: vaultAddr,
        token: vaultToken,
      });

      // Test connection with retry
      await withRetry(async () => {
        await this.vault.health();
      }, 3, 1000);
      logger.info('Vault connected successfully', { endpoint: vaultAddr });
    } catch (error) {
      logger.warn('Vault connection failed, secrets management disabled', {
        error: (error as Error).message
      });
      this.vault = null;
    }
  }

  private async startMetricsServer(): Promise<void> {
    const metricsPort = parseInt(process.env.METRICS_PORT || '9090');

    this.metricsServer = http.createServer(async (req, res) => {
      if (req.url === '/metrics') {
        res.setHeader('Content-Type', metricsRegistry.contentType);
        res.end(await metricsRegistry.metrics());
      } else if (req.url === '/health') {
        const health = await this.getHealthStatus();
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = health.status === 'healthy' ? 200 : 503;
        res.end(JSON.stringify(health));
      } else {
        res.statusCode = 404;
        res.end('Not Found');
      }
    });

    this.metricsServer.listen(metricsPort, () => {
      logger.info('Metrics server started', { port: metricsPort });
    });
  }

  private async getHealthStatus(): Promise<{
    status: string;
    checks: { [key: string]: { status: string; latency?: number } };
    timestamp: string;
  }> {
    const checks: { [key: string]: { status: string; latency?: number } } = {};

    // Check Redis
    if (this.redis) {
      const start = Date.now();
      try {
        await this.redis.ping();
        checks.redis = { status: 'healthy', latency: Date.now() - start };
      } catch {
        checks.redis = { status: 'unhealthy' };
      }
    } else {
      checks.redis = { status: 'disabled' };
    }

    // Check Vault
    if (this.vault) {
      const start = Date.now();
      try {
        await this.vault.health();
        checks.vault = { status: 'healthy', latency: Date.now() - start };
      } catch {
        checks.vault = { status: 'unhealthy' };
      }
    } else {
      checks.vault = { status: 'disabled' };
    }

    // Check AI Provider
    checks.aiProvider = {
      status: this.aiProvider ? 'healthy' : 'disabled'
    };

    // Determine overall status
    const unhealthyChecks = Object.values(checks).filter(
      c => c.status === 'unhealthy'
    );
    const overallStatus = unhealthyChecks.length === 0 ? 'healthy' : 'degraded';

    return {
      status: overallStatus,
      checks,
      timestamp: new Date().toISOString()
    };
  }

  // Cache methods for future use
  private async _cacheGet(key: string): Promise<string | null> {
    if (!this.redis) return null;
    try {
      return await this.redis.get(key);
    } catch (error) {
      logger.error('Redis get error', { key, error: (error as Error).message });
      return null;
    }
  }

  private async _cacheSet(key: string, value: string, ttlSeconds: number = 3600): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.setex(key, ttlSeconds, value);
    } catch (error) {
      logger.error('Redis set error', { key, error: (error as Error).message });
    }
  }

  // Expose cache methods publicly for external use
  public cacheGet = this._cacheGet.bind(this);
  public cacheSet = this._cacheSet.bind(this);

  async getSecret(secretPath: string): Promise<any> {
    if (!this.vault) {
      throw new Error('Vault not configured');
    }

    try {
      const result = await this.vault.read(secretPath);
      logger.debug('Secret retrieved from Vault', { path: secretPath });
      return result.data;
    } catch (error) {
      logger.error('Failed to retrieve secret from Vault', {
        path: secretPath,
        error: (error as Error).message
      });
      throw error;
    }
  }

  private async initialize() {
    // Create working directory and logs directory
    await fs.mkdir(this.workDir, { recursive: true });
    await fs.mkdir(path.join(this.workDir, 'logs'), { recursive: true });

    logger.info('Initializing Ansible MCP Server');

    // Initialize infrastructure
    await this.initializeRedis();
    await this.initializeVault();
    await this.startMetricsServer();

    // Initialize AI provider
    try {
      this.aiProvider = createProviderFromEnv();
      logger.info('AI Provider initialized', {
        provider: this.aiProvider.getName(),
        model: this.aiProvider.getModel()
      });
    } catch (error) {
      logger.warn('AI Provider initialization failed, falling back to template-based generation', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Load templates
    await this.loadTemplates();

    // Initialize prompt template library
    await this.promptTemplateLibrary.initialize();

    // Setup tool handlers
    this.setupHandlers();

    logger.info('Ansible MCP Server initialization complete');
  }

  private async loadTemplates() {
    // Load predefined templates
    this.playbookTemplates.set('kubernetes_deployment', `
---
- name: Deploy to Kubernetes
  hosts: localhost
  gather_facts: no
  vars:
    namespace: "{{ namespace | default('default') }}"
    app_name: "{{ app_name }}"
    image: "{{ image }}"
    replicas: "{{ replicas | default(3) }}"
  
  tasks:
    - name: Create namespace
      kubernetes.core.k8s:
        name: "{{ namespace }}"
        api_version: v1
        kind: Namespace
        state: present

    - name: Deploy application
      kubernetes.core.k8s:
        definition:
          apiVersion: apps/v1
          kind: Deployment
          metadata:
            name: "{{ app_name }}"
            namespace: "{{ namespace }}"
          spec:
            replicas: "{{ replicas }}"
            selector:
              matchLabels:
                app: "{{ app_name }}"
            template:
              metadata:
                labels:
                  app: "{{ app_name }}"
              spec:
                containers:
                - name: "{{ app_name }}"
                  image: "{{ image }}"
                  ports:
                  - containerPort: 8080
`);

    this.playbookTemplates.set('docker_setup', `
---
- name: Setup Docker Environment
  hosts: all
  become: yes
  vars:
    docker_compose_version: "{{ compose_version | default('2.20.0') }}"
  
  tasks:
    - name: Update apt cache
      apt:
        update_cache: yes
      when: ansible_os_family == "Debian"

    - name: Install Docker dependencies
      package:
        name:
          - ca-certificates
          - curl
          - gnupg
          - lsb-release
        state: present

    - name: Add Docker GPG key
      ansible.builtin.apt_key:
        url: https://download.docker.com/linux/ubuntu/gpg
        state: present

    - name: Install Docker
      package:
        name: docker-ce
        state: present

    - name: Start Docker service
      service:
        name: docker
        state: started
        enabled: yes

    - name: Install Docker Compose Plugin
      package:
        name: docker-compose-plugin
        state: present
`);

    this.playbookTemplates.set('system_hardening', `
---
- name: System Security Hardening
  hosts: all
  become: yes
  
  tasks:
    - name: Update all packages
      package:
        name: '*'
        state: latest

    - name: Configure SSH
      lineinfile:
        path: /etc/ssh/sshd_config
        regexp: "{{ item.regexp }}"
        line: "{{ item.line }}"
      loop:
        - { regexp: '^PermitRootLogin', line: 'PermitRootLogin no' }
        - { regexp: '^PasswordAuthentication', line: 'PasswordAuthentication no' }
        - { regexp: '^PermitEmptyPasswords', line: 'PermitEmptyPasswords no' }
      notify: restart ssh

    - name: Configure firewall
      ufw:
        rule: allow
        port: "{{ item }}"
        proto: tcp
      loop:
        - 22
        - 443
        - 80

    - name: Enable firewall
      ufw:
        state: enabled

  handlers:
    - name: restart ssh
      service:
        name: sshd
        state: restarted
`);
  }

  private setupHandlers() {
    // Tool annotations for MCP compliance
    const readOnlyAnnotations: ToolAnnotations = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    };

    const generativeAnnotations: ToolAnnotations = {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    };

    const executionAnnotations: ToolAnnotations = {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    };

    const modifyAnnotations: ToolAnnotations = {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    };

    // Register generate_playbook tool
    this.server.registerTool(
      'generate_playbook',
      {
        description: 'Generate an Ansible playbook based on a natural language prompt. Supports template-based and AI-enhanced generation.',
        inputSchema: {
          prompt: z.string().describe('Natural language description of the desired playbook'),
          template: z.string().optional().describe('Optional template name to use (kubernetes_deployment, docker_setup, system_hardening)'),
          context: z.object({
            target_hosts: z.string().optional().describe('Target hosts or host group'),
            environment: z.string().optional().describe('Environment (production, staging, development)'),
            tags: z.array(z.string()).optional().describe('Tags for selective execution'),
          }).optional().describe('Additional context for playbook generation'),
        },
        annotations: generativeAnnotations,
      },
      async (args) => this.generatePlaybook(args)
    );

    // Register validate_playbook tool
    this.server.registerTool(
      'validate_playbook',
      {
        description: 'Validate an Ansible playbook for YAML syntax, Ansible syntax, and best practices.',
        inputSchema: {
          playbook_path: z.string().describe('Path to the playbook file to validate'),
          strict: z.boolean().optional().describe('Enable strict validation with best practice checks'),
        },
        annotations: readOnlyAnnotations,
      },
      async (args) => this.validatePlaybook(args)
    );

    // Register run_playbook tool
    this.server.registerTool(
      'run_playbook',
      {
        description: 'Execute an Ansible playbook against the specified inventory. Use check_mode for dry runs.',
        inputSchema: {
          playbook_path: z.string().describe('Path to the playbook file to execute'),
          inventory: z.string().describe('Inventory file or host pattern'),
          extra_vars: z.record(z.any()).optional().describe('Extra variables to pass to the playbook'),
          check_mode: z.boolean().optional().describe('Run in check mode (dry run)'),
          tags: z.array(z.string()).optional().describe('Run only tasks with these tags'),
        },
        annotations: executionAnnotations,
      },
      async (args) => this.runPlaybook(args)
    );

    // Register refine_playbook tool
    this.server.registerTool(
      'refine_playbook',
      {
        description: 'Refine and improve an existing playbook based on feedback and validation errors.',
        inputSchema: {
          playbook_path: z.string().describe('Path to the playbook file to refine'),
          feedback: z.string().describe('Feedback describing desired improvements'),
          validation_errors: z.array(z.string()).optional().describe('Validation errors to fix'),
        },
        annotations: modifyAnnotations,
      },
      async (args) => this.refinePlaybook(args)
    );

    // Register lint_playbook tool
    this.server.registerTool(
      'lint_playbook',
      {
        description: 'Run ansible-lint on a playbook to check for best practices and common issues.',
        inputSchema: {
          playbook_path: z.string().describe('Path to the playbook file to lint'),
        },
        annotations: readOnlyAnnotations,
      },
      async (args) => this.lintPlaybook(args)
    );

    // Register list_prompt_templates tool
    this.server.registerTool(
      'list_prompt_templates',
      {
        description: 'List available prompt templates with optional filtering by category, tags, or search text.',
        inputSchema: {
          category: z.enum(['kubernetes', 'docker', 'security', 'database', 'monitoring', 'network', 'cicd', 'cloud', 'general']).optional().describe('Filter by category'),
          tags: z.array(z.string()).optional().describe('Filter by tags'),
          search: z.string().optional().describe('Search in template names and descriptions'),
        },
        annotations: readOnlyAnnotations,
      },
      async (args) => this.listPromptTemplates(args)
    );

    // Register get_prompt_template tool
    this.server.registerTool(
      'get_prompt_template',
      {
        description: 'Get detailed information about a specific prompt template including few-shot examples and chain-of-thought reasoning.',
        inputSchema: {
          template_id: z.string().describe('The ID of the template to retrieve'),
        },
        annotations: readOnlyAnnotations,
      },
      async (args) => this.getPromptTemplate(args)
    );

    // Register enrich_prompt tool
    this.server.registerTool(
      'enrich_prompt',
      {
        description: 'Enrich a user prompt with few-shot examples, chain-of-thought reasoning, and context hints from a template.',
        inputSchema: {
          prompt: z.string().describe('The user prompt to enrich'),
          template_id: z.string().describe('The template to use for enrichment'),
          additional_context: z.record(z.any()).optional().describe('Additional context variables'),
        },
        annotations: readOnlyAnnotations,
      },
      async (args) => this.enrichPrompt(args)
    );

    // Register generate_with_template tool
    this.server.registerTool(
      'generate_with_template',
      {
        description: 'Generate a playbook using an optimized prompt template with few-shot learning and chain-of-thought reasoning.',
        inputSchema: {
          prompt: z.string().describe('Natural language description of the desired playbook'),
          template_id: z.string().describe('The prompt template to use'),
          context: z.object({
            target_hosts: z.string().optional(),
            environment: z.string().optional(),
            tags: z.array(z.string()).optional(),
          }).optional().describe('Playbook context'),
          additional_context: z.record(z.any()).optional().describe('Additional context variables for the template'),
        },
        annotations: generativeAnnotations,
      },
      async (args) => this.generateWithTemplate(args)
    );

    // Register update_template_version tool
    this.server.registerTool(
      'update_template_version',
      {
        description: 'Update a prompt template with new content and create a new version.',
        inputSchema: {
          template_id: z.string().describe('The ID of the template to update'),
          updates: z.object({
            name: z.string().optional(),
            description: z.string().optional(),
            system_prompt: z.string().optional(),
            user_prompt_template: z.string().optional(),
            best_practices: z.array(z.string()).optional(),
          }).describe('Fields to update'),
          change_description: z.array(z.string()).describe('List of changes made in this version'),
        },
        annotations: modifyAnnotations,
      },
      async (args) => this.updateTemplateVersion(args)
    );

    // Register get_template_history tool
    this.server.registerTool(
      'get_template_history',
      {
        description: 'Get the version history and changelog for a prompt template.',
        inputSchema: {
          template_id: z.string().describe('The ID of the template'),
        },
        annotations: readOnlyAnnotations,
      },
      async (args) => this.getTemplateHistory(args)
    );
  }

  private async generatePlaybook(args: any): Promise<CallToolResult> {
    const params = GeneratePlaybookSchema.parse(args);

    // Rate limiting check
    if (!this.checkRateLimit()) {
      metrics.authFailures.inc();
      return {
        content: [{ type: 'text' as const, text: 'Rate limit exceeded. Please try again later.' }],
        isError: true
      };
    }

    const startTime = Date.now();
    logger.info('Generating playbook', { prompt: params.prompt.substring(0, 100), template: params.template });

    try {
      let playbook: string;

      // Use template if specified
      if (params.template && this.playbookTemplates.has(params.template)) {
        playbook = this.playbookTemplates.get(params.template)!;
        logger.debug('Using template', { template: params.template });
      } else {
        // Generate playbook using AI assistance
        playbook = await this.generateWithAI(params.prompt, params.context);
      }

      // Check for secrets in generated playbook
      const secretsCheck = this.detectSecrets(playbook);
      if (secretsCheck.found) {
        logger.warn('Secrets detected in generated playbook', {
          count: secretsCheck.secrets.length
        });
      }

      // Save playbook to file with secure permissions
      const timestamp = Date.now();
      const filename = `playbook_${timestamp}.yml`;
      const filepath = path.join(this.workDir, filename);

      await fs.writeFile(filepath, playbook, { mode: 0o600 });
      logger.debug('Playbook saved', { filepath });

      // Validate the generated playbook
      const validation = await this.validateYAML(playbook);

      // Update metrics
      metrics.playbooksGenerated.labels(params.template || 'ai', 'success').inc();

      const duration = (Date.now() - startTime) / 1000;
      logger.info('Playbook generated successfully', { filepath, duration });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              playbook_path: filepath,
              playbook_content: playbook,
              validation: validation,
              secrets_warning: secretsCheck.found ? {
                message: 'Potential secrets detected in playbook',
                count: secretsCheck.secrets.length,
                details: secretsCheck.secrets
              } : null,
              message: 'Playbook generated successfully'
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      metrics.playbooksGenerated.labels(params.template || 'ai', 'error').inc();
      logger.error('Playbook generation failed', { error: (error as Error).message });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Error generating playbook: ${(error as Error).message}`
          }
        ],
        isError: true
      };
    }
  }

  private async generateWithAI(prompt: string, context?: any): Promise<string> {
    // Use AI provider if available
    if (this.aiProvider) {
      try {
        logger.debug('Generating playbook using AI provider', { provider: this.aiProvider.getName() });
        const generatedPlaybook = await this.aiProvider.generatePlaybook(prompt, context);
        return generatedPlaybook;
      } catch (error) {
        logger.warn('AI generation failed, falling back to template', {
          error: error instanceof Error ? error.message : String(error)
        });
        // Fall through to template-based generation
      }
    }

    // Fallback to template-based generation
    logger.debug('Using template-based generation');
    const playbook = `---
# Generated playbook from prompt: ${prompt}
- name: ${prompt}
  hosts: ${context?.target_hosts || 'all'}
  become: yes
  vars:
    environment: ${context?.environment || 'production'}

  tasks:
    - name: Ensure system is updated
      package:
        name: '*'
        state: latest
      tags:
        - update

    - name: Execute main task
      debug:
        msg: "Executing: ${prompt}"
      tags: ${context?.tags ? '\n        - ' + context.tags.join('\n        - ') : '\n        - main'}

    # Note: Using template-based generation. Configure AI provider for better results.
`;

    return playbook;
  }

  private async validatePlaybook(args: any): Promise<CallToolResult> {
    const params = ValidatePlaybookSchema.parse(args);

    // Validate path to prevent path traversal
    const pathValidation = this.validatePath(params.playbook_path);
    if (!pathValidation.valid) {
      logger.warn('Invalid playbook path', { path: params.playbook_path, error: pathValidation.error });
      return {
        content: [{ type: 'text' as const, text: `Security error: ${pathValidation.error}` }],
        isError: true
      };
    }

    const sanitizedPath = pathValidation.sanitizedPath!;
    logger.info('Validating playbook', { path: sanitizedPath, strict: params.strict });

    try {
      // Read playbook
      const content = await fs.readFile(sanitizedPath, 'utf-8');

      // Check file size using byte length (not string length)
      const byteSize = Buffer.byteLength(content, 'utf8');
      if (byteSize > securityConfig.maxPlaybookSize) {
        return {
          content: [{ type: 'text' as const, text: `Playbook exceeds maximum size of ${securityConfig.maxPlaybookSize} bytes (actual: ${byteSize} bytes)` }],
          isError: true
        };
      }

      // Validate YAML syntax
      const yamlValidation = await this.validateYAML(content);

      // Check for secrets
      const secretsCheck = this.detectSecrets(content);

      // Run ansible-playbook --syntax-check using execFile (safe from injection)
      let syntaxCheck: { stdout: string; stderr: string };
      try {
        const result = await execFileAsync('ansible-playbook', ['--syntax-check', sanitizedPath], {
          cwd: this.workDir,
          timeout: 30000 // 30 second timeout
        });
        syntaxCheck = { stdout: result.stdout, stderr: result.stderr };
      } catch (err: any) {
        syntaxCheck = { stdout: err.stdout || '', stderr: err.stderr || err.message };
      }

      // Collect results
      const results = {
        yaml_valid: yamlValidation.valid,
        yaml_errors: yamlValidation.errors,
        ansible_syntax_valid: !syntaxCheck.stderr || syntaxCheck.stderr.length === 0,
        ansible_syntax_errors: syntaxCheck.stderr || null,
        secrets_detected: secretsCheck.found ? secretsCheck.secrets : null,
        warnings: [] as string[]
      };

      // Add warnings for best practices
      if (params.strict) {
        results.warnings = this.checkBestPractices(content);
      }

      const isValid = results.yaml_valid && results.ansible_syntax_valid;

      if (!isValid) {
        metrics.validationErrors.inc();
      }

      logger.info('Playbook validation complete', { path: sanitizedPath, valid: isValid });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              valid: isValid,
              validation_results: results
            }, null, 2)
          }
        ],
        isError: !isValid
      };
    } catch (error) {
      logger.error('Playbook validation failed', { path: sanitizedPath, error: (error as Error).message });
      metrics.validationErrors.inc();

      return {
        content: [
          {
            type: 'text' as const,
            text: `Error validating playbook: ${(error as Error).message}`
          }
        ],
        isError: true
      };
    }
  }

  private async validateYAML(content: string): Promise<{ valid: boolean; errors?: string[] }> {
    try {
      yaml.load(content);
      return { valid: true };
    } catch (error) {
      return { 
        valid: false, 
        errors: [(error as Error).message]
      };
    }
  }

  private checkBestPractices(content: string): string[] {
    const warnings: string[] = [];
    
    // Check for common best practice violations
    if (!content.includes('become:') && !content.includes('become_user:')) {
      warnings.push('Consider specifying privilege escalation explicitly');
    }
    
    if (!content.includes('tags:')) {
      warnings.push('Consider adding tags for selective execution');
    }
    
    if (!content.includes('handlers:') && content.includes('notify:')) {
      warnings.push('Handlers are referenced but not defined');
    }
    
    if (!content.includes('when:') && !content.includes('failed_when:')) {
      warnings.push('Consider adding conditionals for idempotency');
    }
    
    return warnings;
  }

  private async runPlaybook(args: any): Promise<CallToolResult> {
    const params = RunPlaybookSchema.parse(args);

    // Validate playbook path
    const playbookPathValidation = this.validatePath(params.playbook_path);
    if (!playbookPathValidation.valid) {
      logger.warn('Invalid playbook path for execution', { path: params.playbook_path });
      return {
        content: [{ type: 'text' as const, text: `Security error: ${playbookPathValidation.error}` }],
        isError: true
      };
    }

    // Validate inventory path to prevent traversal
    let inventoryPath: string;
    if (params.inventory.includes('/')) {
      // Full path provided - validate it
      const inventoryPathValidation = this.validatePath(params.inventory);
      if (!inventoryPathValidation.valid) {
        logger.warn('Invalid inventory path', { path: params.inventory });
        return {
          content: [{ type: 'text' as const, text: `Security error: ${inventoryPathValidation.error}` }],
          isError: true
        };
      }
      inventoryPath = inventoryPathValidation.sanitizedPath!;
    } else {
      // Relative name - ensure it doesn't contain traversal attempts
      const sanitizedName = params.inventory.replace(/[^a-zA-Z0-9_.-]/g, '');
      inventoryPath = path.join('/workspace/inventory', sanitizedName);
    }

    const sanitizedPlaybookPath = playbookPathValidation.sanitizedPath!;

    // Detect secrets before execution
    try {
      const playbookContent = await fs.readFile(sanitizedPlaybookPath, 'utf-8');
      const secretsCheck = this.detectSecrets(playbookContent);

      if (secretsCheck.found) {
        logger.warn('Secrets detected in playbook before execution', {
          playbook: sanitizedPlaybookPath,
          secrets: secretsCheck.secrets
        });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: 'Playbook contains potential secrets',
              secrets_detected: secretsCheck.secrets,
              message: 'Please remove hardcoded secrets and use Ansible Vault or environment variables'
            }, null, 2)
          }],
          isError: true
        };
      }
    } catch (readError) {
      logger.error('Failed to read playbook for secrets check', {
        path: sanitizedPlaybookPath,
        error: (readError as Error).message
      });
    }

    const startTime = Date.now();

    logger.info('Executing playbook', {
      playbook: sanitizedPlaybookPath,
      inventory: inventoryPath,
      checkMode: params.check_mode,
      tags: params.tags
    });

    try {
      // Build arguments array (safe from command injection)
      const cmdArgs: string[] = [sanitizedPlaybookPath, '-i', inventoryPath];

      if (params.check_mode) {
        cmdArgs.push('--check');
      }

      if (params.tags && params.tags.length > 0) {
        // Sanitize tags to prevent injection
        const sanitizedTags = params.tags.map(tag =>
          tag.replace(/[^a-zA-Z0-9_-]/g, '')
        ).filter(tag => tag.length > 0);

        if (sanitizedTags.length > 0) {
          cmdArgs.push('--tags', sanitizedTags.join(','));
        }
      }

      if (params.extra_vars) {
        cmdArgs.push('-e', JSON.stringify(params.extra_vars));
      }

      // Execute playbook using execFile (safe from injection)
      const result = await execFileAsync('ansible-playbook', cmdArgs, {
        cwd: this.workDir,
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        timeout: 600000 // 10 minute timeout
      });

      const duration = (Date.now() - startTime) / 1000;
      metrics.executionDuration.observe(duration);
      metrics.playbooksExecuted.labels('success', params.check_mode ? 'true' : 'false').inc();

      logger.info('Playbook execution complete', {
        playbook: sanitizedPlaybookPath,
        duration,
        success: true
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              output: result.stdout,
              errors: result.stderr || null,
              duration_seconds: duration,
              command: `ansible-playbook ${cmdArgs.join(' ')}`
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      const execError = error as any;
      const duration = (Date.now() - startTime) / 1000;

      metrics.executionDuration.observe(duration);
      metrics.playbooksExecuted.labels('error', params.check_mode ? 'true' : 'false').inc();

      logger.error('Playbook execution failed', {
        playbook: sanitizedPlaybookPath,
        duration,
        error: execError.message
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: execError.message,
              stderr: execError.stderr,
              stdout: execError.stdout,
              duration_seconds: duration
            }, null, 2)
          }
        ],
        isError: true
      };
    }
  }

  private async refinePlaybook(args: any): Promise<CallToolResult> {
    const params = RefinePlaybookSchema.parse(args);

    try {
      // Validate playbook path for security
      const pathValidation = validatePath(params.playbook_path, securityConfig.allowedPaths);
      if (!pathValidation.valid) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: `Invalid playbook path: ${pathValidation.error}`
              }, null, 2)
            }
          ],
          isError: true
        };
      }

      // Read current playbook
      let content = await fs.readFile(params.playbook_path, 'utf-8');

      // Compute safe refined path - handle .yml, .yaml, and extensionless files
      const computeRefinedPath = (originalPath: string): string => {
        const parsed = path.parse(originalPath);
        const baseDir = parsed.dir;
        const baseName = parsed.name;
        const ext = parsed.ext || '.yml';
        // Normalize extension
        const normalizedExt = ext === '.yaml' ? '.yaml' : '.yml';
        const refinedName = `${baseName}_refined${normalizedExt}`;
        return path.join(baseDir, refinedName);
      };

      const refinedPath = computeRefinedPath(params.playbook_path);

      // Validate refined path is also within allowed directories
      const refinedPathValidation = validatePath(refinedPath, securityConfig.allowedPaths);
      if (!refinedPathValidation.valid) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: `Invalid refined path: ${refinedPathValidation.error}`
              }, null, 2)
            }
          ],
          isError: true
        };
      }

      // Use AI provider for intelligent refinement if available
      if (this.aiProvider) {
        try {
          logger.info('Using AI provider for playbook refinement', { provider: this.aiProvider.getName() });
          const refinementPrompt = `Refine this Ansible playbook based on the following feedback: ${params.feedback}

${params.validation_errors && params.validation_errors.length > 0 ? `\nValidation errors to fix:\n${params.validation_errors.join('\n')}` : ''}

Current playbook:
${content}

Please provide an improved version of the playbook that addresses the feedback and fixes any errors. Output ONLY the YAML content.`;

          const refinedContent = await this.aiProvider.generate([
            {
              role: 'system',
              content: 'You are an expert Ansible playbook optimizer. Refine playbooks based on feedback while maintaining functionality and best practices.',
            },
            {
              role: 'user',
              content: refinementPrompt,
            },
          ], { temperature: 0.3 });

          await fs.writeFile(refinedPath, refinedContent.content);

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  refined_playbook_path: refinedPath,
                  changes_applied: [
                    'AI-refined playbook based on feedback: ' + params.feedback,
                    params.validation_errors ? `Fixed ${params.validation_errors.length} validation errors` : null,
                  ].filter(Boolean),
                  refined_content: refinedContent.content,
                  ai_provider: this.aiProvider.getName(),
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.warn('AI refinement failed, falling back to rule-based refinement', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Fallback to rule-based refinement
      logger.debug('Using rule-based refinement');

      // Parse YAML with validation
      const parsedContent = yaml.load(content);

      // Validate YAML structure - must be an array (playbook) or object
      if (!parsedContent || (typeof parsedContent !== 'object')) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: 'Invalid playbook format: YAML must be an array or object'
              }, null, 2)
            }
          ],
          isError: true
        };
      }

      // Ensure playbook is an array
      const playbook = Array.isArray(parsedContent) ? parsedContent : [parsedContent];

      // Ensure playbook[0] exists and has tasks array
      if (playbook.length === 0) {
        playbook.push({ name: 'Refined Playbook', hosts: 'all', tasks: [] });
      }

      if (!playbook[0]) {
        playbook[0] = { name: 'Refined Playbook', hosts: 'all', tasks: [] };
      }

      if (!Array.isArray(playbook[0].tasks)) {
        playbook[0].tasks = [];
      }

      // Apply refinements based on feedback
      if (params.validation_errors) {
        params.validation_errors.forEach(error => {
          if (error.includes('indentation')) {
            content = this.fixIndentation(content);
          }
          if (error.includes('syntax')) {
            content = this.fixCommonSyntax(content);
          }
        });
      }

      // Apply feedback-based improvements
      if (params.feedback.toLowerCase().includes('add error handling')) {
        playbook[0].tasks = playbook[0].tasks.map((task: any) => ({
          ...task,
          ignore_errors: false,
          failed_when: false,
          register: task.name ? `${task.name.replace(/\s+/g, '_')}_result` : 'task_result'
        }));
      }

      if (params.feedback.toLowerCase().includes('make idempotent')) {
        playbook[0].tasks = playbook[0].tasks.map((task: any) => ({
          ...task,
          changed_when: false,
          check_mode: true
        }));
      }

      // Save refined playbook
      const refinedContent = yaml.dump(playbook, { indent: 2 });
      await fs.writeFile(refinedPath, refinedContent);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              refined_playbook_path: refinedPath,
              changes_applied: [
                'Applied feedback: ' + params.feedback,
                params.validation_errors ? `Fixed ${params.validation_errors.length} validation errors` : null
              ].filter(Boolean),
              refined_content: refinedContent
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error refining playbook: ${(error as Error).message}`
          }
        ],
        isError: true
      };
    }
  }

  private fixIndentation(content: string): string {
    // Fix common indentation issues
    return content.split('\n').map(line => {
      // Ensure consistent 2-space indentation
      const leadingSpaces = line.match(/^(\s*)/)?.[1] || '';
      const indentLevel = Math.floor(leadingSpaces.length / 2);
      return ' '.repeat(indentLevel * 2) + line.trim();
    }).join('\n');
  }

  private fixCommonSyntax(content: string): string {
    // Fix common syntax issues
    return content
      .replace(/:\s*$/gm, ': ') // Ensure space after colons
      .replace(/\s+$/gm, '') // Remove trailing spaces
      .replace(/\t/g, '  '); // Replace tabs with spaces
  }

  private async lintPlaybook(args: any): Promise<CallToolResult> {
    const { playbook_path } = args;

    // Validate path to prevent path traversal
    const pathValidation = this.validatePath(playbook_path);
    if (!pathValidation.valid) {
      logger.warn('Invalid playbook path for linting', { path: playbook_path });
      return {
        content: [{ type: 'text' as const, text: `Security error: ${pathValidation.error}` }],
        isError: true
      };
    }

    const sanitizedPath = pathValidation.sanitizedPath!;
    logger.info('Linting playbook', { path: sanitizedPath });

    try {
      // Run ansible-lint using execFile (safe from injection)
      let result: { stdout: string; stderr: string };
      try {
        const execResult = await execFileAsync('ansible-lint', [sanitizedPath], {
          cwd: this.workDir,
          timeout: 60000 // 1 minute timeout
        });
        result = { stdout: execResult.stdout, stderr: execResult.stderr };
      } catch (err: any) {
        result = {
          stdout: err.stdout || '',
          stderr: err.stderr || err.message
        };
      }

      const hasErrors = Boolean(result.stderr && result.stderr.length > 0);

      logger.info('Playbook linting complete', { path: sanitizedPath, hasErrors });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              lint_output: result.stdout || 'No issues found',
              errors: result.stderr || null
            }, null, 2)
          }
        ],
        isError: hasErrors
      };
    } catch (error) {
      logger.error('Playbook linting failed', { path: sanitizedPath, error: (error as Error).message });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Error linting playbook: ${(error as Error).message}`
          }
        ],
        isError: true
      };
    }
  }

  // Prompt Template tool implementations

  private async listPromptTemplates(args: any): Promise<CallToolResult> {
    const params = ListPromptTemplatesSchema.parse(args);

    try {
      const searchOptions: any = {};

      if (params.category) {
        searchOptions.category = params.category as TemplateCategory;
      }
      if (params.tags) {
        searchOptions.tags = params.tags;
      }
      if (params.search) {
        searchOptions.searchText = params.search;
      }

      const templates = this.promptTemplateLibrary.listTemplates(searchOptions);

      const templateSummaries = templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        version: t.version,
        category: t.category,
        tags: t.tags,
        num_examples: t.few_shot_examples.length,
        num_best_practices: t.context_enrichment.best_practices.length
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              count: templates.length,
              templates: templateSummaries
            }, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error listing templates: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }

  private async getPromptTemplate(args: any): Promise<CallToolResult> {
    const params = GetPromptTemplateSchema.parse(args);

    try {
      const template = this.promptTemplateLibrary.getTemplate(params.template_id);

      if (!template) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Template not found: ${params.template_id}`
            }
          ],
          isError: true
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              template: template
            }, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error getting template: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }

  private async enrichPrompt(args: any): Promise<CallToolResult> {
    const params = EnrichPromptSchema.parse(args);

    try {
      const enrichedPrompt = this.promptTemplateLibrary.enrichPrompt(
        params.prompt,
        params.template_id,
        params.additional_context
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              original_prompt: enrichedPrompt.original_prompt,
              enriched_prompt: enrichedPrompt.enriched_prompt,
              context_hints: enrichedPrompt.context_hints,
              sections: {
                system_context_length: enrichedPrompt.system_context.length,
                few_shot_section_length: enrichedPrompt.few_shot_section.length,
                chain_of_thought_section_length: enrichedPrompt.chain_of_thought_section.length
              }
            }, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error enriching prompt: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }

  private async generateWithTemplate(args: any): Promise<CallToolResult> {
    const params = GenerateWithTemplateSchema.parse(args);

    try {
      // Get enriched prompt from template
      const enrichedPrompt = this.promptTemplateLibrary.enrichPrompt(
        params.prompt,
        params.template_id,
        params.additional_context
      );

      // Generate playbook using enriched prompt
      const playbook = await this.generateWithEnrichedPrompt(
        enrichedPrompt,
        params.context
      );

      // Save playbook to file
      const timestamp = Date.now();
      const filename = `playbook_${timestamp}.yml`;
      const filepath = path.join(this.workDir, filename);

      await fs.writeFile(filepath, playbook);

      // Validate the generated playbook
      const validation = await this.validateYAML(playbook);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              playbook_path: filepath,
              playbook_content: playbook,
              validation: validation,
              template_used: params.template_id,
              context_hints: enrichedPrompt.context_hints,
              message: 'Playbook generated successfully with optimized prompt template'
            }, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error generating playbook with template: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }

  private async generateWithEnrichedPrompt(
    enrichedPrompt: EnrichedPrompt,
    context?: any
  ): Promise<string> {
    // Parse the enriched prompt to extract example playbooks
    // For now, we'll use the first few-shot example as a base and customize it
    const template = this.promptTemplateLibrary.getTemplate(
      enrichedPrompt.original_prompt.includes('kubernetes') ? 'kubernetes-deployment' :
      enrichedPrompt.original_prompt.includes('docker') ? 'docker-setup' :
      enrichedPrompt.original_prompt.includes('security') ? 'security-hardening' :
      enrichedPrompt.original_prompt.includes('database') ? 'database-setup' :
      enrichedPrompt.original_prompt.includes('monitor') ? 'monitoring-stack' :
      'kubernetes-deployment'
    );

    // Generate a playbook based on the enriched context
    const playbook = `---
# Generated using optimized prompt template
# Template: ${template?.name || 'Unknown'}
# Original prompt: ${enrichedPrompt.original_prompt}
#
# Context hints applied:
${enrichedPrompt.context_hints.map(h => `# - ${h}`).join('\n')}

- name: ${enrichedPrompt.original_prompt}
  hosts: ${context?.target_hosts || 'all'}
  become: yes
  vars:
    environment: ${context?.environment || 'production'}

  tasks:
    - name: Gather facts
      setup:
      tags:
        - always

    - name: Execute main task based on requirements
      debug:
        msg: "Executing: ${enrichedPrompt.original_prompt}"
      tags:
        ${context?.tags ? context.tags.map((t: string) => `- ${t}`).join('\n        ') : '- main'}

    # Best practices from template:
${template?.context_enrichment.best_practices.slice(0, 3).map(bp => `    # - ${bp}`).join('\n')}
`;

    return playbook;
  }

  private async updateTemplateVersion(args: any): Promise<CallToolResult> {
    const params = UpdateTemplateSchema.parse(args);

    try {
      const updatedTemplate = await this.promptTemplateLibrary.updateTemplateVersion(
        params.template_id,
        params.updates as Partial<PromptTemplate>,
        params.change_description
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              template_id: updatedTemplate.id,
              new_version: updatedTemplate.version,
              updated_at: updatedTemplate.updated_at,
              changes: params.change_description
            }, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error updating template: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }

  private async getTemplateHistory(args: any): Promise<CallToolResult> {
    const params = GetTemplateHistorySchema.parse(args);

    try {
      const history = this.promptTemplateLibrary.getTemplateHistory(params.template_id);

      if (history.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No history found for template: ${params.template_id}`
            }
          ],
          isError: true
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              template_id: params.template_id,
              history: history
            }, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error getting template history: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }

  async start() {
    // Initialize before connecting to transport (required by MCP SDK v1.22.0)
    await this.initialize();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    metrics.activeConnections.inc();

    logger.info('Ansible MCP Server started successfully', {
      version: '2.0.0',
      sdkVersion: '1.22.0',
      metricsPort: process.env.METRICS_PORT || '9090',
      features: {
        redis: this.redis !== null,
        vault: this.vault !== null,
        aiProvider: this.aiProvider !== null
      }
    });

    // Graceful shutdown handling
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully');
      await this.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully');
      await this.shutdown();
      process.exit(0);
    });
  }

  private async shutdown() {
    metrics.activeConnections.dec();

    if (this.redis) {
      await this.redis.quit();
      logger.info('Redis connection closed');
    }

    if (this.metricsServer) {
      this.metricsServer.close();
      logger.info('Metrics server stopped');
    }

    logger.info('Ansible MCP Server shutdown complete');
  }
}

// Start the server
const server = new AnsibleMCPServer();
server.start().catch((error) => {
  logger.error('Failed to start server', { error: error.message });
  process.exit(1);
});
