/**
 * Prompt Template Library for Ansible MCP Server
 *
 * Features:
 * - Optimized prompt templates for common Ansible use cases
 * - Few-shot learning examples
 * - Chain-of-thought reasoning
 * - Context enrichment system
 * - Template versioning
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface FewShotExample {
  input: string;
  output: string;
  explanation?: string;
}

export interface ChainOfThought {
  steps: string[];
  reasoning_pattern: string;
}

export interface ContextEnrichment {
  required_context: string[];
  optional_context: string[];
  environment_hints: Record<string, string[]>;
  best_practices: string[];
}

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  version: string;
  category: TemplateCategory;

  // Core template
  system_prompt: string;
  user_prompt_template: string;

  // Few-shot learning
  few_shot_examples: FewShotExample[];

  // Chain-of-thought reasoning
  chain_of_thought: ChainOfThought;

  // Context enrichment
  context_enrichment: ContextEnrichment;

  // Metadata
  tags: string[];
  created_at: string;
  updated_at: string;
  author: string;

  // Versioning
  changelog: VersionChange[];
}

export interface VersionChange {
  version: string;
  date: string;
  changes: string[];
}

export enum TemplateCategory {
  KUBERNETES = 'kubernetes',
  DOCKER = 'docker',
  SECURITY = 'security',
  DATABASE = 'database',
  MONITORING = 'monitoring',
  NETWORK = 'network',
  CICD = 'cicd',
  CLOUD = 'cloud',
  GENERAL = 'general'
}

export interface TemplateSearchOptions {
  category?: TemplateCategory;
  tags?: string[];
  searchText?: string;
}

export interface EnrichedPrompt {
  original_prompt: string;
  enriched_prompt: string;
  system_context: string;
  few_shot_section: string;
  chain_of_thought_section: string;
  context_hints: string[];
}

// ============================================================================
// Prompt Template Library
// ============================================================================

export class PromptTemplateLibrary {
  private templates: Map<string, PromptTemplate>;
  private templatesDir: string;

  constructor(templatesDir: string = '/tmp/ansible-mcp/templates') {
    this.templates = new Map();
    this.templatesDir = templatesDir;
    this.loadDefaultTemplates();
  }

  // --------------------------------------------------------------------------
  // Template Management
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    await fs.mkdir(this.templatesDir, { recursive: true });
    await this.loadTemplatesFromDisk();
  }

  private loadDefaultTemplates(): void {
    // Load all default templates
    const defaultTemplates = this.createDefaultTemplates();
    defaultTemplates.forEach(template => {
      this.templates.set(template.id, template);
    });
  }

  private async loadTemplatesFromDisk(): Promise<void> {
    // Read directory, only swallow ENOENT (directory not found)
    let files: string[];
    try {
      files = await fs.readdir(this.templatesDir);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Directory doesn't exist yet, this is expected
        return;
      }
      // Unexpected error reading directory, log and rethrow
      console.error(`Failed to read templates directory ${this.templatesDir}:`, error);
      throw error;
    }

    // Process each JSON file individually
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filepath = path.join(this.templatesDir, file);
        try {
          const content = await fs.readFile(filepath, 'utf-8');
          const template = JSON.parse(content) as PromptTemplate;
          this.templates.set(template.id, template);
        } catch (error: unknown) {
          // Log error with filename and skip this file
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`Failed to load template from ${file}: ${errorMessage}`);
          // Continue processing other files
        }
      }
    }
  }

  async saveTemplate(template: PromptTemplate): Promise<void> {
    // Ensure directory exists before writing
    await fs.mkdir(this.templatesDir, { recursive: true });
    const filename = `${template.id}.json`;
    const filepath = path.join(this.templatesDir, filename);
    await fs.writeFile(filepath, JSON.stringify(template, null, 2));
    this.templates.set(template.id, template);
  }

  getTemplate(id: string): PromptTemplate | undefined {
    return this.templates.get(id);
  }

  listTemplates(options?: TemplateSearchOptions): PromptTemplate[] {
    let results = Array.from(this.templates.values());

    if (options?.category) {
      results = results.filter(t => t.category === options.category);
    }

    if (options?.tags && options.tags.length > 0) {
      results = results.filter(t =>
        options.tags!.some(tag => t.tags.includes(tag))
      );
    }

    if (options?.searchText) {
      const search = options.searchText.toLowerCase();
      results = results.filter(t =>
        t.name.toLowerCase().includes(search) ||
        t.description.toLowerCase().includes(search)
      );
    }

    return results;
  }

  // --------------------------------------------------------------------------
  // Prompt Enrichment with Chain-of-Thought and Few-Shot Learning
  // --------------------------------------------------------------------------

  enrichPrompt(
    userPrompt: string,
    templateId: string,
    additionalContext?: Record<string, any>
  ): EnrichedPrompt {
    const template = this.templates.get(templateId);

    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Build system context with best practices
    const systemContext = this.buildSystemContext(template);

    // Build few-shot examples section
    const fewShotSection = this.buildFewShotSection(template);

    // Build chain-of-thought section
    const cotSection = this.buildChainOfThoughtSection(template);

    // Extract context hints
    const contextHints = this.extractContextHints(
      userPrompt,
      template,
      additionalContext
    );

    // Build enriched prompt
    const enrichedPrompt = this.combinePromptSections(
      template,
      userPrompt,
      systemContext,
      fewShotSection,
      cotSection,
      contextHints
    );

    return {
      original_prompt: userPrompt,
      enriched_prompt: enrichedPrompt,
      system_context: systemContext,
      few_shot_section: fewShotSection,
      chain_of_thought_section: cotSection,
      context_hints: contextHints
    };
  }

  private buildSystemContext(template: PromptTemplate): string {
    const parts: string[] = [
      template.system_prompt,
      '',
      '## Best Practices to Follow:',
      ...template.context_enrichment.best_practices.map(bp => `- ${bp}`)
    ];

    return parts.join('\n');
  }

  private buildFewShotSection(template: PromptTemplate): string {
    if (template.few_shot_examples.length === 0) {
      return '';
    }

    const parts: string[] = [
      '## Examples:',
      ''
    ];

    template.few_shot_examples.forEach((example, index) => {
      parts.push(`### Example ${index + 1}:`);
      parts.push(`**Input:** ${example.input}`);
      parts.push('');
      parts.push(`**Output:**`);
      parts.push('```yaml');
      parts.push(example.output);
      parts.push('```');

      if (example.explanation) {
        parts.push(`**Explanation:** ${example.explanation}`);
      }
      parts.push('');
    });

    return parts.join('\n');
  }

  private buildChainOfThoughtSection(template: PromptTemplate): string {
    const cot = template.chain_of_thought;

    const parts: string[] = [
      '## Reasoning Process:',
      `Follow the "${cot.reasoning_pattern}" pattern:`,
      ''
    ];

    cot.steps.forEach((step, index) => {
      parts.push(`${index + 1}. ${step}`);
    });

    return parts.join('\n');
  }

  private extractContextHints(
    userPrompt: string,
    template: PromptTemplate,
    additionalContext?: Record<string, any>
  ): string[] {
    const hints: string[] = [];
    const promptLower = userPrompt.toLowerCase();

    // Environment-specific hints
    const envHints = template.context_enrichment.environment_hints;
    for (const [env, envHintList] of Object.entries(envHints)) {
      if (promptLower.includes(env)) {
        hints.push(...envHintList);
      }
    }

    // Add required context reminders
    const missingContext = template.context_enrichment.required_context.filter(
      ctx => !additionalContext || !additionalContext[ctx]
    );

    if (missingContext.length > 0) {
      hints.push(
        `Consider specifying: ${missingContext.join(', ')}`
      );
    }

    return hints;
  }

  private combinePromptSections(
    template: PromptTemplate,
    userPrompt: string,
    systemContext: string,
    fewShotSection: string,
    cotSection: string,
    contextHints: string[]
  ): string {
    const parts: string[] = [
      systemContext,
      '',
      fewShotSection,
      '',
      cotSection,
      '',
      '## Your Task:',
      template.user_prompt_template.replace('{{user_prompt}}', userPrompt)
    ];

    if (contextHints.length > 0) {
      parts.push('');
      parts.push('## Additional Context Hints:');
      contextHints.forEach(hint => parts.push(`- ${hint}`));
    }

    return parts.join('\n');
  }

  // --------------------------------------------------------------------------
  // Version Management
  // --------------------------------------------------------------------------

  async updateTemplateVersion(
    templateId: string,
    updates: Partial<PromptTemplate>,
    changeDescription: string[]
  ): Promise<PromptTemplate> {
    const existing = this.templates.get(templateId);

    if (!existing) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Increment version
    const versionParts = existing.version.split('.').map(Number);
    versionParts[2] = (versionParts[2] || 0) + 1;
    const newVersion = versionParts.join('.');

    // Create updated template
    const updated: PromptTemplate = {
      ...existing,
      ...updates,
      version: newVersion,
      updated_at: new Date().toISOString(),
      changelog: [
        {
          version: newVersion,
          date: new Date().toISOString(),
          changes: changeDescription
        },
        ...existing.changelog
      ]
    };

    await this.saveTemplate(updated);
    return updated;
  }

  getTemplateHistory(templateId: string): VersionChange[] {
    const template = this.templates.get(templateId);
    return template?.changelog || [];
  }

  // --------------------------------------------------------------------------
  // Default Templates
  // --------------------------------------------------------------------------

  private createDefaultTemplates(): PromptTemplate[] {
    return [
      this.createKubernetesTemplate(),
      this.createDockerTemplate(),
      this.createSecurityHardeningTemplate(),
      this.createDatabaseTemplate(),
      this.createMonitoringTemplate(),
      this.createCICDTemplate(),
      this.createCloudInfraTemplate(),
      this.createNetworkTemplate()
    ];
  }

  private createKubernetesTemplate(): PromptTemplate {
    return {
      id: 'kubernetes-deployment',
      name: 'Kubernetes Deployment',
      description: 'Generate production-ready Kubernetes deployment playbooks with best practices for scaling, monitoring, and security',
      version: '1.0.0',
      category: TemplateCategory.KUBERNETES,

      system_prompt: `You are an expert Ansible and Kubernetes engineer. Generate production-ready Ansible playbooks for Kubernetes deployments.

Your playbooks must:
- Use kubernetes.core collection modules
- Include proper resource limits and requests
- Implement health checks (liveness and readiness probes)
- Support multiple environments (dev, staging, production)
- Include proper labels and annotations
- Handle secrets securely using Kubernetes secrets or external secret management`,

      user_prompt_template: `Generate an Ansible playbook for the following Kubernetes deployment requirement:

{{user_prompt}}

Ensure the playbook:
1. Creates necessary namespaces
2. Deploys the application with proper resource management
3. Sets up services and ingress if needed
4. Includes ConfigMaps and Secrets
5. Implements proper rolling update strategy`,

      few_shot_examples: [
        {
          input: 'Deploy a web application with 3 replicas and auto-scaling',
          output: `---
- name: Deploy Web Application to Kubernetes
  hosts: localhost
  gather_facts: no
  vars:
    app_name: "{{ application_name }}"
    namespace: "{{ kube_namespace | default('default') }}"
    replicas: "{{ replica_count | default(3) }}"
    image: "{{ container_image }}"

  tasks:
    - name: Create namespace
      kubernetes.core.k8s:
        state: present
        definition:
          apiVersion: v1
          kind: Namespace
          metadata:
            name: "{{ namespace }}"
            labels:
              environment: "{{ environment | default('production') }}"

    - name: Deploy application
      kubernetes.core.k8s:
        state: present
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
                  resources:
                    requests:
                      memory: "256Mi"
                      cpu: "250m"
                    limits:
                      memory: "512Mi"
                      cpu: "500m"
                  livenessProbe:
                    httpGet:
                      path: /health
                      port: 8080
                    initialDelaySeconds: 30
                    periodSeconds: 10
                  readinessProbe:
                    httpGet:
                      path: /ready
                      port: 8080
                    initialDelaySeconds: 5
                    periodSeconds: 5

    - name: Create HorizontalPodAutoscaler
      kubernetes.core.k8s:
        state: present
        definition:
          apiVersion: autoscaling/v2
          kind: HorizontalPodAutoscaler
          metadata:
            name: "{{ app_name }}-hpa"
            namespace: "{{ namespace }}"
          spec:
            scaleTargetRef:
              apiVersion: apps/v1
              kind: Deployment
              name: "{{ app_name }}"
            minReplicas: "{{ replicas }}"
            maxReplicas: 10
            metrics:
            - type: Resource
              resource:
                name: cpu
                target:
                  type: Utilization
                  averageUtilization: 70`,
          explanation: 'This playbook creates a namespace, deploys an application with resource limits, health checks, and sets up auto-scaling based on CPU utilization.'
        },
        {
          input: 'Deploy a database with persistent storage',
          output: `---
- name: Deploy StatefulSet Database
  hosts: localhost
  gather_facts: no
  vars:
    db_name: "{{ database_name | default('postgres') }}"
    namespace: "{{ kube_namespace | default('databases') }}"
    storage_size: "{{ db_storage_size | default('10Gi') }}"

  tasks:
    - name: Create PersistentVolumeClaim
      kubernetes.core.k8s:
        state: present
        definition:
          apiVersion: v1
          kind: PersistentVolumeClaim
          metadata:
            name: "{{ db_name }}-pvc"
            namespace: "{{ namespace }}"
          spec:
            accessModes:
              - ReadWriteOnce
            resources:
              requests:
                storage: "{{ storage_size }}"
            storageClassName: standard

    - name: Deploy database as StatefulSet
      kubernetes.core.k8s:
        state: present
        definition:
          apiVersion: apps/v1
          kind: StatefulSet
          metadata:
            name: "{{ db_name }}"
            namespace: "{{ namespace }}"
          spec:
            serviceName: "{{ db_name }}"
            replicas: 1
            selector:
              matchLabels:
                app: "{{ db_name }}"
            template:
              metadata:
                labels:
                  app: "{{ db_name }}"
              spec:
                containers:
                - name: "{{ db_name }}"
                  image: postgres:15
                  ports:
                  - containerPort: 5432
                  volumeMounts:
                  - name: data
                    mountPath: /var/lib/postgresql/data
                  env:
                  - name: POSTGRES_PASSWORD
                    valueFrom:
                      secretKeyRef:
                        name: "{{ db_name }}-secret"
                        key: password
            volumeClaimTemplates:
            - metadata:
                name: data
              spec:
                accessModes: ["ReadWriteOnce"]
                resources:
                  requests:
                    storage: "{{ storage_size }}"`,
          explanation: 'This playbook creates a StatefulSet for database workloads with persistent storage and proper secret management for credentials.'
        }
      ],

      chain_of_thought: {
        steps: [
          'Identify the application type (stateless/stateful) and requirements',
          'Determine resource requirements (CPU, memory, storage)',
          'Plan namespace and labeling strategy',
          'Design health checks appropriate for the application',
          'Configure scaling strategy (manual, HPA, VPA)',
          'Set up networking (Service, Ingress)',
          'Implement security (RBAC, NetworkPolicies, Secrets)',
          'Add monitoring and logging annotations'
        ],
        reasoning_pattern: 'Infrastructure Design Pattern'
      },

      context_enrichment: {
        required_context: [
          'application_name',
          'container_image',
          'namespace'
        ],
        optional_context: [
          'replica_count',
          'resource_limits',
          'environment',
          'ingress_host',
          'tls_secret'
        ],
        environment_hints: {
          'production': [
            'Use at least 3 replicas for high availability',
            'Enable PodDisruptionBudget',
            'Configure resource limits strictly',
            'Enable network policies'
          ],
          'staging': [
            'Mirror production configuration with reduced resources',
            'Enable all monitoring',
            'Use same security settings as production'
          ],
          'development': [
            'Single replica may be sufficient',
            'Relax resource limits for faster iteration',
            'Consider using emptyDir for ephemeral storage'
          ]
        },
        best_practices: [
          'Always define resource requests and limits',
          'Use liveness and readiness probes',
          'Implement proper labeling conventions',
          'Use ConfigMaps for configuration, Secrets for sensitive data',
          'Implement PodDisruptionBudget for production workloads',
          'Use init containers for dependencies',
          'Add pod anti-affinity for high availability'
        ]
      },

      tags: ['kubernetes', 'k8s', 'deployment', 'containers', 'orchestration'],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      author: 'Ansible MCP Team',
      changelog: [
        {
          version: '1.0.0',
          date: '2024-01-01T00:00:00Z',
          changes: ['Initial template release']
        }
      ]
    };
  }

  private createDockerTemplate(): PromptTemplate {
    return {
      id: 'docker-setup',
      name: 'Docker Environment Setup',
      description: 'Set up Docker and Docker Compose environments with security best practices',
      version: '1.0.0',
      category: TemplateCategory.DOCKER,

      system_prompt: `You are an expert in containerization and Docker. Generate Ansible playbooks for Docker environment setup and container management.

Your playbooks must:
- Install Docker using official repositories
- Configure Docker daemon with security best practices
- Set up Docker Compose
- Configure proper user permissions
- Implement container logging and monitoring`,

      user_prompt_template: `Generate an Ansible playbook for Docker setup:

{{user_prompt}}

Include:
1. Docker installation from official sources
2. Docker daemon configuration
3. User group management
4. Docker Compose installation
5. Post-installation verification`,

      few_shot_examples: [
        {
          input: 'Install Docker with rootless mode and log rotation',
          output: `---
- name: Install Docker with Rootless Mode
  hosts: all
  become: yes
  vars:
    docker_users: "{{ users_to_add | default([]) }}"

  tasks:
    - name: Install prerequisites
      package:
        name:
          - apt-transport-https
          - ca-certificates
          - curl
          - gnupg
          - uidmap
          - dbus-user-session
          - fuse-overlayfs
        state: present

    - name: Add Docker GPG key
      apt_key:
        url: https://download.docker.com/linux/ubuntu/gpg
        state: present

    - name: Add Docker repository
      apt_repository:
        repo: "deb [arch=amd64] https://download.docker.com/linux/ubuntu {{ ansible_distribution_release }} stable"
        state: present

    - name: Install Docker
      package:
        name:
          - docker-ce
          - docker-ce-cli
          - containerd.io
          - docker-ce-rootless-extras
        state: present

    - name: Configure Docker daemon
      copy:
        dest: /etc/docker/daemon.json
        content: |
          {
            "log-driver": "json-file",
            "log-opts": {
              "max-size": "10m",
              "max-file": "3"
            },
            "storage-driver": "overlay2",
            "live-restore": true,
            "userland-proxy": false
          }
      notify: restart docker

    - name: Enable and start Docker
      systemd:
        name: docker
        state: started
        enabled: yes

  handlers:
    - name: restart docker
      systemd:
        name: docker
        state: restarted`,
          explanation: 'This playbook installs Docker with rootless mode support and configures log rotation to prevent disk space issues.'
        }
      ],

      chain_of_thought: {
        steps: [
          'Check target OS and version compatibility',
          'Install required prerequisites',
          'Add official Docker repository',
          'Install Docker packages',
          'Configure Docker daemon settings',
          'Set up user permissions',
          'Install Docker Compose',
          'Verify installation'
        ],
        reasoning_pattern: 'Sequential Installation Pattern'
      },

      context_enrichment: {
        required_context: ['target_hosts'],
        optional_context: [
          'docker_users',
          'docker_compose_version',
          'registry_mirrors',
          'storage_driver'
        ],
        environment_hints: {
          'production': [
            'Enable live-restore for zero-downtime daemon restarts',
            'Configure log rotation to prevent disk exhaustion',
            'Use overlay2 storage driver',
            'Disable userland-proxy for better performance'
          ],
          'development': [
            'Add developers to docker group for convenience',
            'Consider enabling BuildKit by default',
            'Set up local registry mirror for faster pulls'
          ]
        },
        best_practices: [
          'Always use official Docker repositories',
          'Configure log rotation',
          'Use overlay2 storage driver',
          'Enable live-restore for production',
          'Limit container capabilities',
          'Use user namespaces when possible',
          'Configure resource limits'
        ]
      },

      tags: ['docker', 'containers', 'setup', 'compose'],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      author: 'Ansible MCP Team',
      changelog: [
        {
          version: '1.0.0',
          date: '2024-01-01T00:00:00Z',
          changes: ['Initial template release']
        }
      ]
    };
  }

  private createSecurityHardeningTemplate(): PromptTemplate {
    return {
      id: 'security-hardening',
      name: 'System Security Hardening',
      description: 'Comprehensive security hardening for Linux systems following CIS benchmarks',
      version: '1.0.0',
      category: TemplateCategory.SECURITY,

      system_prompt: `You are a security expert specializing in Linux system hardening. Generate Ansible playbooks that implement security best practices based on CIS benchmarks and industry standards.

Your playbooks must:
- Follow CIS benchmark recommendations
- Implement defense in depth
- Configure proper audit logging
- Set up intrusion detection
- Harden network configuration
- Secure authentication mechanisms`,

      user_prompt_template: `Generate a security hardening playbook:

{{user_prompt}}

The playbook must address:
1. SSH hardening
2. Firewall configuration
3. System audit logging
4. User and permission management
5. Network security
6. Service hardening`,

      few_shot_examples: [
        {
          input: 'Harden SSH and configure firewall with fail2ban',
          output: `---
- name: Security Hardening - SSH and Firewall
  hosts: all
  become: yes
  vars:
    ssh_port: "{{ custom_ssh_port | default(22) }}"
    allowed_ssh_users: "{{ ssh_users | default([]) }}"

  tasks:
    - name: Configure SSH hardening
      lineinfile:
        path: /etc/ssh/sshd_config
        regexp: "{{ item.regexp }}"
        line: "{{ item.line }}"
        state: present
        validate: 'sshd -t -f %s'
      loop:
        - { regexp: '^#?Port', line: 'Port {{ ssh_port }}' }
        - { regexp: '^#?PermitRootLogin', line: 'PermitRootLogin no' }
        - { regexp: '^#?PasswordAuthentication', line: 'PasswordAuthentication no' }
        - { regexp: '^#?PermitEmptyPasswords', line: 'PermitEmptyPasswords no' }
        - { regexp: '^#?X11Forwarding', line: 'X11Forwarding no' }
        - { regexp: '^#?MaxAuthTries', line: 'MaxAuthTries 3' }
        - { regexp: '^#?ClientAliveInterval', line: 'ClientAliveInterval 300' }
        - { regexp: '^#?ClientAliveCountMax', line: 'ClientAliveCountMax 2' }
        - { regexp: '^#?LoginGraceTime', line: 'LoginGraceTime 60' }
        - { regexp: '^#?AllowAgentForwarding', line: 'AllowAgentForwarding no' }
        - { regexp: '^#?AllowTcpForwarding', line: 'AllowTcpForwarding no' }
      notify: restart sshd
      tags:
        - ssh
        - security

    - name: Restrict SSH to specific users
      lineinfile:
        path: /etc/ssh/sshd_config
        line: "AllowUsers {{ allowed_ssh_users | join(' ') }}"
        state: present
      when: allowed_ssh_users | length > 0
      notify: restart sshd
      tags:
        - ssh
        - security

    - name: Install and configure UFW
      package:
        name: ufw
        state: present
      tags:
        - firewall
        - security

    - name: Set UFW default policies
      ufw:
        direction: "{{ item.direction }}"
        policy: "{{ item.policy }}"
      loop:
        - { direction: 'incoming', policy: 'deny' }
        - { direction: 'outgoing', policy: 'allow' }
      tags:
        - firewall
        - security

    - name: Allow SSH through firewall
      ufw:
        rule: allow
        port: "{{ ssh_port }}"
        proto: tcp
      tags:
        - firewall
        - security

    - name: Enable UFW
      ufw:
        state: enabled
      tags:
        - firewall
        - security

    - name: Install fail2ban
      package:
        name: fail2ban
        state: present
      tags:
        - fail2ban
        - security

    - name: Configure fail2ban for SSH
      copy:
        dest: /etc/fail2ban/jail.local
        content: |
          [DEFAULT]
          bantime = 3600
          findtime = 600
          maxretry = 3

          [sshd]
          enabled = true
          port = {{ ssh_port }}
          filter = sshd
          logpath = /var/log/auth.log
          maxretry = 3
          bantime = 3600
      notify: restart fail2ban
      tags:
        - fail2ban
        - security

  handlers:
    - name: restart sshd
      systemd:
        name: sshd
        state: restarted

    - name: restart fail2ban
      systemd:
        name: fail2ban
        state: restarted`,
          explanation: 'This playbook implements SSH hardening with key-only authentication, configures UFW firewall with deny-by-default policy, and sets up fail2ban for brute-force protection.'
        }
      ],

      chain_of_thought: {
        steps: [
          'Identify the attack surface and threat model',
          'Plan authentication hardening (SSH, PAM)',
          'Design network security (firewall, network segmentation)',
          'Configure audit and logging',
          'Set up intrusion detection',
          'Harden file system permissions',
          'Secure running services',
          'Implement ongoing monitoring'
        ],
        reasoning_pattern: 'Defense in Depth Pattern'
      },

      context_enrichment: {
        required_context: ['target_hosts'],
        optional_context: [
          'ssh_port',
          'allowed_users',
          'allowed_ports',
          'audit_rules'
        ],
        environment_hints: {
          'production': [
            'Implement all CIS benchmark recommendations',
            'Enable comprehensive audit logging',
            'Configure centralized log shipping',
            'Set up real-time alerting for security events',
            'Implement network segmentation'
          ],
          'development': [
            'Balance security with developer productivity',
            'Consider less restrictive SSH settings for convenience',
            'Enable but may relax some firewall rules'
          ]
        },
        best_practices: [
          'Use key-based SSH authentication only',
          'Implement fail2ban or similar brute-force protection',
          'Configure firewall with deny-by-default policy',
          'Enable audit logging for security events',
          'Regular security updates',
          'Principle of least privilege',
          'Disable unnecessary services',
          'Use strong cryptographic algorithms'
        ]
      },

      tags: ['security', 'hardening', 'ssh', 'firewall', 'cis'],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      author: 'Ansible MCP Team',
      changelog: [
        {
          version: '1.0.0',
          date: '2024-01-01T00:00:00Z',
          changes: ['Initial template release']
        }
      ]
    };
  }

  private createDatabaseTemplate(): PromptTemplate {
    return {
      id: 'database-setup',
      name: 'Database Setup and Configuration',
      description: 'Set up and configure databases with replication, backup, and security',
      version: '1.0.0',
      category: TemplateCategory.DATABASE,

      system_prompt: `You are a database administrator expert. Generate Ansible playbooks for database installation, configuration, replication, and backup.

Your playbooks must:
- Install databases from official repositories
- Configure for production performance
- Set up replication for high availability
- Implement backup strategies
- Secure database access`,

      user_prompt_template: `Generate a database setup playbook:

{{user_prompt}}

Include:
1. Database installation
2. Initial configuration
3. User and permission setup
4. Backup configuration
5. Monitoring setup`,

      few_shot_examples: [
        {
          input: 'Set up PostgreSQL with streaming replication',
          output: `---
- name: PostgreSQL Primary Setup
  hosts: db_primary
  become: yes
  vars:
    postgres_version: "15"
    replication_user: "replicator"
    replication_password: "{{ vault_replication_password }}"

  tasks:
    - name: Install PostgreSQL
      package:
        name:
          - "postgresql-{{ postgres_version }}"
          - "postgresql-contrib-{{ postgres_version }}"
        state: present

    - name: Configure PostgreSQL for replication
      lineinfile:
        path: "/etc/postgresql/{{ postgres_version }}/main/postgresql.conf"
        regexp: "{{ item.regexp }}"
        line: "{{ item.line }}"
      loop:
        - { regexp: '^#?wal_level', line: "wal_level = replica" }
        - { regexp: '^#?max_wal_senders', line: "max_wal_senders = 5" }
        - { regexp: '^#?wal_keep_size', line: "wal_keep_size = 1GB" }
        - { regexp: '^#?hot_standby', line: "hot_standby = on" }
      notify: restart postgresql

    - name: Create replication user
      postgresql_user:
        name: "{{ replication_user }}"
        password: "{{ replication_password }}"
        role_attr_flags: REPLICATION,LOGIN
      become_user: postgres

  handlers:
    - name: restart postgresql
      systemd:
        name: postgresql
        state: restarted`,
          explanation: 'This playbook sets up a PostgreSQL primary server configured for streaming replication with proper WAL settings.'
        }
      ],

      chain_of_thought: {
        steps: [
          'Choose database type based on requirements',
          'Plan installation and initial configuration',
          'Design schema and user management',
          'Configure for performance (memory, connections)',
          'Set up replication topology',
          'Implement backup strategy',
          'Configure monitoring and alerting',
          'Plan disaster recovery procedures'
        ],
        reasoning_pattern: 'Data Infrastructure Pattern'
      },

      context_enrichment: {
        required_context: [
          'database_type',
          'database_name',
          'database_user',
          'database_password'
        ],
        optional_context: [
          'replication_mode',
          'backup_schedule',
          'memory_settings',
          'connection_limits'
        ],
        environment_hints: {
          'production': [
            'Enable synchronous replication for critical data',
            'Configure automated backups with point-in-time recovery',
            'Set up connection pooling',
            'Enable query logging for slow queries',
            'Implement proper SSL/TLS encryption'
          ],
          'development': [
            'Single instance may be sufficient',
            'Relax some security settings for convenience',
            'Consider using containers for easy reset'
          ]
        },
        best_practices: [
          'Always use strong passwords stored in vault',
          'Enable SSL for client connections',
          'Implement proper backup rotation',
          'Monitor replication lag',
          'Set appropriate connection limits',
          'Configure proper logging',
          'Regular vacuum and analyze for PostgreSQL',
          'Use connection pooling for high traffic'
        ]
      },

      tags: ['database', 'postgresql', 'mysql', 'mongodb', 'replication', 'backup'],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      author: 'Ansible MCP Team',
      changelog: [
        {
          version: '1.0.0',
          date: '2024-01-01T00:00:00Z',
          changes: ['Initial template release']
        }
      ]
    };
  }

  private createMonitoringTemplate(): PromptTemplate {
    return {
      id: 'monitoring-stack',
      name: 'Monitoring Stack Setup',
      description: 'Deploy comprehensive monitoring with Prometheus, Grafana, and alerting',
      version: '1.0.0',
      category: TemplateCategory.MONITORING,

      system_prompt: `You are an observability expert. Generate Ansible playbooks for setting up comprehensive monitoring stacks.

Your playbooks must:
- Install and configure Prometheus
- Set up Grafana with dashboards
- Configure alerting rules
- Deploy exporters for various services
- Set up log aggregation`,

      user_prompt_template: `Generate a monitoring stack playbook:

{{user_prompt}}

Include:
1. Prometheus installation and configuration
2. Grafana setup with data sources
3. Alert manager configuration
4. Exporter deployment
5. Dashboard provisioning`,

      few_shot_examples: [
        {
          input: 'Deploy Prometheus and Grafana with node monitoring',
          output: `---
- name: Deploy Monitoring Stack
  hosts: monitoring
  become: yes
  vars:
    prometheus_version: "2.47.0"
    grafana_admin_password: "{{ vault_grafana_password }}"

  tasks:
    - name: Create prometheus user
      user:
        name: prometheus
        system: yes
        shell: /sbin/nologin

    - name: Download Prometheus
      unarchive:
        src: "https://github.com/prometheus/prometheus/releases/download/v{{ prometheus_version }}/prometheus-{{ prometheus_version }}.linux-amd64.tar.gz"
        dest: /opt
        remote_src: yes
        owner: prometheus

    - name: Configure Prometheus
      template:
        src: prometheus.yml.j2
        dest: /etc/prometheus/prometheus.yml
      notify: restart prometheus

    - name: Create Prometheus systemd service
      copy:
        dest: /etc/systemd/system/prometheus.service
        content: |
          [Unit]
          Description=Prometheus
          Wants=network-online.target
          After=network-online.target

          [Service]
          User=prometheus
          ExecStart=/opt/prometheus-{{ prometheus_version }}.linux-amd64/prometheus --config.file=/etc/prometheus/prometheus.yml
          Restart=always

          [Install]
          WantedBy=multi-user.target
      notify:
        - reload systemd
        - restart prometheus

    - name: Install Grafana
      apt:
        deb: https://dl.grafana.com/oss/release/grafana_10.0.0_amd64.deb
      notify: restart grafana

    - name: Configure Grafana admin password
      grafana_user:
        url: http://localhost:3000
        login_user: admin
        login_password: admin
        name: admin
        password: "{{ grafana_admin_password }}"
        is_admin: yes

  handlers:
    - name: reload systemd
      systemd:
        daemon_reload: yes

    - name: restart prometheus
      systemd:
        name: prometheus
        state: restarted
        enabled: yes

    - name: restart grafana
      systemd:
        name: grafana-server
        state: restarted
        enabled: yes`,
          explanation: 'This playbook deploys Prometheus and Grafana, configures them as services, and sets up the admin password.'
        }
      ],

      chain_of_thought: {
        steps: [
          'Identify metrics to collect and their sources',
          'Design Prometheus architecture (single/HA)',
          'Plan scrape configurations and targets',
          'Configure retention and storage',
          'Set up alerting rules and receivers',
          'Design Grafana dashboards',
          'Configure data sources',
          'Implement high availability if needed'
        ],
        reasoning_pattern: 'Observability Design Pattern'
      },

      context_enrichment: {
        required_context: ['target_hosts'],
        optional_context: [
          'retention_days',
          'scrape_interval',
          'alerting_receivers',
          'custom_dashboards'
        ],
        environment_hints: {
          'production': [
            'Enable Prometheus HA with Thanos or Victoria Metrics',
            'Configure long-term storage',
            'Set up comprehensive alerting',
            'Use persistent storage for Grafana',
            'Configure alert deduplication'
          ],
          'development': [
            'Single Prometheus instance is sufficient',
            'Shorter retention period acceptable',
            'Basic dashboards for debugging'
          ]
        },
        best_practices: [
          'Use service discovery when possible',
          'Configure appropriate scrape intervals',
          'Implement alerting with proper severity levels',
          'Use recording rules for expensive queries',
          'Set up dashboard versioning',
          'Configure proper data retention',
          'Use labels effectively for querying',
          'Monitor the monitoring system itself'
        ]
      },

      tags: ['monitoring', 'prometheus', 'grafana', 'alerting', 'observability'],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      author: 'Ansible MCP Team',
      changelog: [
        {
          version: '1.0.0',
          date: '2024-01-01T00:00:00Z',
          changes: ['Initial template release']
        }
      ]
    };
  }

  private createCICDTemplate(): PromptTemplate {
    return {
      id: 'cicd-pipeline',
      name: 'CI/CD Pipeline Setup',
      description: 'Set up CI/CD pipelines with Jenkins, GitLab CI, or GitHub Actions',
      version: '1.0.0',
      category: TemplateCategory.CICD,

      system_prompt: `You are a DevOps engineer specializing in CI/CD. Generate Ansible playbooks for setting up continuous integration and deployment pipelines.

Your playbooks must:
- Install and configure CI/CD tools
- Set up build agents/runners
- Configure pipeline integrations
- Implement secure credential management
- Set up artifact storage`,

      user_prompt_template: `Generate a CI/CD setup playbook:

{{user_prompt}}

Include:
1. CI/CD server installation
2. Agent/runner configuration
3. Pipeline configuration
4. Integration with version control
5. Artifact management`,

      few_shot_examples: [
        {
          input: 'Set up Jenkins with Docker agents',
          output: `---
- name: Deploy Jenkins with Docker Agents
  hosts: jenkins_server
  become: yes
  vars:
    jenkins_admin_password: "{{ vault_jenkins_password }}"

  tasks:
    - name: Install Java
      package:
        name: openjdk-17-jdk
        state: present

    - name: Add Jenkins repository key
      apt_key:
        url: https://pkg.jenkins.io/debian-stable/jenkins.io-2023.key
        state: present

    - name: Add Jenkins repository
      apt_repository:
        repo: deb https://pkg.jenkins.io/debian-stable binary/
        state: present

    - name: Install Jenkins
      package:
        name: jenkins
        state: present

    - name: Install Docker for Jenkins agents
      package:
        name: docker.io
        state: present

    - name: Add Jenkins user to docker group
      user:
        name: jenkins
        groups: docker
        append: yes
      notify: restart jenkins

    - name: Configure Jenkins
      template:
        src: jenkins.yaml.j2
        dest: /var/lib/jenkins/jenkins.yaml
      notify: restart jenkins

  handlers:
    - name: restart jenkins
      systemd:
        name: jenkins
        state: restarted`,
          explanation: 'This playbook installs Jenkins with Java, sets up Docker for running containerized build agents, and configures Jenkins as code.'
        }
      ],

      chain_of_thought: {
        steps: [
          'Choose CI/CD platform based on requirements',
          'Plan server/controller installation',
          'Design agent/runner topology',
          'Configure build environment and tools',
          'Set up credential management',
          'Configure pipeline templates',
          'Integrate with version control',
          'Set up notifications and reporting'
        ],
        reasoning_pattern: 'Automation Pipeline Pattern'
      },

      context_enrichment: {
        required_context: ['target_hosts', 'cicd_platform'],
        optional_context: [
          'num_agents',
          'build_tools',
          'artifact_storage',
          'vcs_integration'
        ],
        environment_hints: {
          'production': [
            'Use distributed builds with multiple agents',
            'Configure high availability for CI server',
            'Implement proper secret management',
            'Set up audit logging',
            'Configure backup for CI/CD configuration'
          ],
          'development': [
            'Single agent may be sufficient',
            'Local Docker agents for quick feedback',
            'Enable verbose logging for debugging'
          ]
        },
        best_practices: [
          'Use pipeline as code (Jenkinsfile, .gitlab-ci.yml)',
          'Implement proper credential management',
          'Use containerized builds for consistency',
          'Configure appropriate timeouts',
          'Implement build caching',
          'Set up proper artifact retention',
          'Use parallel stages where possible',
          'Implement proper testing stages'
        ]
      },

      tags: ['cicd', 'jenkins', 'gitlab', 'pipeline', 'automation'],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      author: 'Ansible MCP Team',
      changelog: [
        {
          version: '1.0.0',
          date: '2024-01-01T00:00:00Z',
          changes: ['Initial template release']
        }
      ]
    };
  }

  private createCloudInfraTemplate(): PromptTemplate {
    return {
      id: 'cloud-infrastructure',
      name: 'Cloud Infrastructure Provisioning',
      description: 'Provision and configure cloud infrastructure on AWS, Azure, or GCP',
      version: '1.0.0',
      category: TemplateCategory.CLOUD,

      system_prompt: `You are a cloud architect. Generate Ansible playbooks for provisioning and managing cloud infrastructure.

Your playbooks must:
- Use official cloud provider collections
- Implement infrastructure as code best practices
- Configure proper networking and security
- Set up monitoring and logging
- Implement cost optimization`,

      user_prompt_template: `Generate a cloud infrastructure playbook:

{{user_prompt}}

Include:
1. Network infrastructure (VPC, subnets)
2. Compute resources
3. Security groups and IAM
4. Storage configuration
5. Monitoring setup`,

      few_shot_examples: [
        {
          input: 'Provision AWS VPC with public and private subnets',
          output: `---
- name: Provision AWS VPC Infrastructure
  hosts: localhost
  gather_facts: no
  vars:
    vpc_cidr: "10.0.0.0/16"
    region: "us-east-1"
    project_name: "{{ project | default('myproject') }}"

  tasks:
    - name: Create VPC
      amazon.aws.ec2_vpc_net:
        name: "{{ project_name }}-vpc"
        cidr_block: "{{ vpc_cidr }}"
        region: "{{ region }}"
        tags:
          Project: "{{ project_name }}"
          Environment: "{{ environment }}"
      register: vpc

    - name: Create public subnet
      amazon.aws.ec2_vpc_subnet:
        vpc_id: "{{ vpc.vpc.id }}"
        cidr: "10.0.1.0/24"
        az: "{{ region }}a"
        tags:
          Name: "{{ project_name }}-public"
          Type: public
      register: public_subnet

    - name: Create private subnet
      amazon.aws.ec2_vpc_subnet:
        vpc_id: "{{ vpc.vpc.id }}"
        cidr: "10.0.2.0/24"
        az: "{{ region }}a"
        tags:
          Name: "{{ project_name }}-private"
          Type: private
      register: private_subnet

    - name: Create Internet Gateway
      amazon.aws.ec2_vpc_igw:
        vpc_id: "{{ vpc.vpc.id }}"
        state: present
      register: igw

    - name: Create NAT Gateway
      amazon.aws.ec2_vpc_nat_gateway:
        subnet_id: "{{ public_subnet.subnet.id }}"
        wait: yes
        region: "{{ region }}"
      register: nat_gw`,
          explanation: 'This playbook creates a VPC with public and private subnets, an Internet Gateway for public access, and a NAT Gateway for private subnet outbound access.'
        }
      ],

      chain_of_thought: {
        steps: [
          'Design network topology (VPC, subnets, routing)',
          'Plan security (security groups, NACLs, IAM)',
          'Determine compute requirements',
          'Design storage architecture',
          'Configure load balancing and auto-scaling',
          'Set up monitoring and logging',
          'Implement backup and disaster recovery',
          'Plan cost optimization'
        ],
        reasoning_pattern: 'Cloud Architecture Pattern'
      },

      context_enrichment: {
        required_context: ['cloud_provider', 'region'],
        optional_context: [
          'vpc_cidr',
          'availability_zones',
          'instance_types',
          'storage_requirements'
        ],
        environment_hints: {
          'production': [
            'Use multiple availability zones',
            'Implement proper encryption at rest and in transit',
            'Configure auto-scaling',
            'Enable VPC flow logs',
            'Use private subnets for sensitive workloads'
          ],
          'development': [
            'Single AZ may be acceptable',
            'Use smaller instance types',
            'Consider spot instances for cost savings'
          ]
        },
        best_practices: [
          'Use infrastructure as code',
          'Implement proper tagging strategy',
          'Use private subnets for databases',
          'Enable encryption by default',
          'Configure proper IAM roles and policies',
          'Use parameter store or secrets manager',
          'Implement cost allocation tags',
          'Enable CloudTrail for auditing'
        ]
      },

      tags: ['cloud', 'aws', 'azure', 'gcp', 'infrastructure', 'vpc'],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      author: 'Ansible MCP Team',
      changelog: [
        {
          version: '1.0.0',
          date: '2024-01-01T00:00:00Z',
          changes: ['Initial template release']
        }
      ]
    };
  }

  private createNetworkTemplate(): PromptTemplate {
    return {
      id: 'network-configuration',
      name: 'Network Configuration',
      description: 'Configure networking including load balancers, DNS, and routing',
      version: '1.0.0',
      category: TemplateCategory.NETWORK,

      system_prompt: `You are a network engineer. Generate Ansible playbooks for network configuration and management.

Your playbooks must:
- Configure load balancers (HAProxy, Nginx, etc.)
- Set up DNS and service discovery
- Implement proper routing
- Configure SSL/TLS termination
- Set up network monitoring`,

      user_prompt_template: `Generate a network configuration playbook:

{{user_prompt}}

Include:
1. Load balancer setup
2. SSL/TLS configuration
3. Routing rules
4. Health checks
5. Monitoring integration`,

      few_shot_examples: [
        {
          input: 'Configure HAProxy with SSL termination',
          output: `---
- name: Configure HAProxy Load Balancer
  hosts: loadbalancer
  become: yes
  vars:
    haproxy_frontend_port: 443
    backend_servers: "{{ backend_hosts }}"
    ssl_cert_path: "/etc/ssl/certs/{{ domain }}.pem"

  tasks:
    - name: Install HAProxy
      package:
        name: haproxy
        state: present

    - name: Configure HAProxy
      template:
        src: haproxy.cfg.j2
        dest: /etc/haproxy/haproxy.cfg
        validate: haproxy -c -f %s
      notify: restart haproxy

    - name: Copy SSL certificate
      copy:
        src: "{{ ssl_cert_file }}"
        dest: "{{ ssl_cert_path }}"
        mode: '0600'
      notify: restart haproxy

    - name: Enable HAProxy stats
      blockinfile:
        path: /etc/haproxy/haproxy.cfg
        block: |
          listen stats
            bind *:8404
            stats enable
            stats uri /stats
            stats auth admin:{{ haproxy_stats_password }}

  handlers:
    - name: restart haproxy
      systemd:
        name: haproxy
        state: restarted`,
          explanation: 'This playbook configures HAProxy with SSL termination, backend server configuration, and stats monitoring.'
        }
      ],

      chain_of_thought: {
        steps: [
          'Identify load balancing requirements',
          'Design SSL/TLS strategy',
          'Plan health check configuration',
          'Configure routing rules',
          'Set up session persistence if needed',
          'Configure rate limiting',
          'Set up monitoring and logging',
          'Plan failover strategy'
        ],
        reasoning_pattern: 'Network Design Pattern'
      },

      context_enrichment: {
        required_context: ['target_hosts', 'backend_servers'],
        optional_context: [
          'ssl_certificate',
          'health_check_path',
          'session_persistence',
          'rate_limits'
        ],
        environment_hints: {
          'production': [
            'Use active-passive or active-active HA',
            'Configure proper SSL/TLS with modern ciphers',
            'Implement rate limiting',
            'Enable access logging',
            'Configure proper health checks'
          ],
          'development': [
            'Self-signed certificates acceptable',
            'Simpler health checks',
            'Single LB instance may suffice'
          ]
        },
        best_practices: [
          'Use TLS 1.3 or 1.2 only',
          'Configure HSTS',
          'Implement proper health checks',
          'Use connection draining',
          'Configure appropriate timeouts',
          'Enable access logging',
          'Implement rate limiting',
          'Use keep-alive connections'
        ]
      },

      tags: ['network', 'load-balancer', 'haproxy', 'nginx', 'ssl', 'routing'],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      author: 'Ansible MCP Team',
      changelog: [
        {
          version: '1.0.0',
          date: '2024-01-01T00:00:00Z',
          changes: ['Initial template release']
        }
      ]
    };
  }
}

// Export singleton instance
export const promptTemplateLibrary = new PromptTemplateLibrary();
