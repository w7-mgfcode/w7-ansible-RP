# Architecture Guide

> How the Ansible MCP Server components fit together

---

## Objectives

- Understand system architecture and components
- Learn data flow through the system
- Know design rationale and trade-offs

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Component Architecture](#component-architecture)
3. [Data Flow](#data-flow)
4. [MCP Protocol Integration](#mcp-protocol-integration)
5. [Security Architecture](#security-architecture)
6. [Scalability Considerations](#scalability-considerations)

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User / AI Agent                              │
│                    (Natural Language Input)                          │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ MCP Protocol (JSON-RPC over stdio)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Ansible MCP Server (TypeScript)                   │
│  ┌────────────┬────────────┬─────────────┬────────────────────┐    │
│  │ Tool Router│ Validators │ AI Provider │ Prompt Templates   │    │
│  │ (15+ tools)│ (YAML/Lint)│ (4 options) │ (Few-shot learning)│    │
│  └────────────┴────────────┴─────────────┴────────────────────┘    │
│  ┌────────────┬────────────┬─────────────────────────────────┐     │
│  │ Security   │ Metrics    │ Infrastructure Integration      │     │
│  │ (Secrets)  │ (Prom)     │ (Redis, Vault, Health)          │     │
│  └────────────┴────────────┴─────────────────────────────────┘     │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│    Redis     │    │    Vault     │    │  PostgreSQL  │
│   (Cache)    │    │  (Secrets)   │    │  (Storage)   │
└──────────────┘    └──────────────┘    └──────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Generated Ansible Playbooks                       │
│                    (YAML files in /playbooks)                        │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ Ansible Execution
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Target Infrastructure                           │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐         │
│  │ Servers  │ K8s      │ Cloud    │ Docker   │ Network  │         │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Architecture

### Core Components

#### 1. MCP Server (`src/server.ts`)

**Purpose:** Main entry point and tool router

**Key responsibilities:**
- Register and route MCP tools
- Handle authentication and rate limiting
- Coordinate between AI providers and validators
- Manage playbook lifecycle

**Technology stack:**
- TypeScript/Node.js 20
- @modelcontextprotocol/sdk v1.22.0
- McpServer high-level API

**Why TypeScript?**
- Strong typing for MCP protocol
- Excellent async/await support
- Large ecosystem of infrastructure libraries
- Easy Docker containerization

#### 2. AI Provider System (`src/providers/`)

**Purpose:** Pluggable AI provider integration

**Architecture:**
```
AIProvider (interface)
    ├── OpenAIProvider
    ├── AnthropicProvider
    ├── GeminiProvider
    └── OllamaProvider
```

**Key methods:**
- `generatePlaybook(prompt, context)` - Main generation
- `generate(messages, options)` - Low-level API
- `getName()`, `getModel()` - Provider info

**Why multiple providers?**
- Different cost/quality trade-offs
- Local deployment option (Ollama)
- Provider redundancy
- User preference

#### 3. Prompt Template Library (`src/prompt_templates.ts`)

**Purpose:** Optimized prompts with few-shot learning

**Features:**
- Pre-built templates by category
- Few-shot examples for each template
- Chain-of-thought reasoning patterns
- Version control and changelog

**Why few-shot learning?**
- Consistent output format
- Higher quality playbooks
- Reduced hallucinations
- Domain-specific knowledge

#### 4. Playbook Generator (`src/playbook_generator.py`)

**Purpose:** Python-based playbook generation logic

**Features:**
- Prompt analysis (type detection)
- Requirement extraction (HA, security, etc.)
- Template selection and customization
- Task enhancement based on context

**Why Python?**
- Native Ansible integration
- Rich ML/AI libraries
- Easy YAML manipulation
- FastAPI for REST endpoints

### Infrastructure Components

#### Redis

**Purpose:** Caching and job queue

**Used for:**
- Caching generated playbooks
- Template storage
- Rate limit tracking
- Future: job queue for async execution

**Why Redis?**
- Fast in-memory operations
- Persistence options
- Well-supported in Node.js
- Simple to deploy

#### HashiCorp Vault

**Purpose:** Secrets management

**Used for:**
- Storing sensitive Ansible variables
- API key management
- Dynamic secret generation
- Credential rotation

**Why Vault?**
- Industry standard for secrets
- Dynamic secrets support
- Audit logging
- Fine-grained access control

#### PostgreSQL

**Purpose:** Persistent storage

**Used for:**
- Web UI user accounts
- Playbook history
- Execution logs
- AWX database

**Why PostgreSQL?**
- Reliable and mature
- JSON support for flexible schemas
- AWX compatibility
- Good TypeORM support

### Monitoring Components

#### Prometheus

**Purpose:** Metrics collection

**Metrics exposed:**
```
ansible_mcp_playbooks_generated_total{template, status}
ansible_mcp_playbooks_executed_total{status, check_mode}
ansible_mcp_validation_errors_total
ansible_mcp_execution_duration_seconds
ansible_mcp_secrets_detected_total
ansible_mcp_auth_failures_total
ansible_mcp_active_connections
```

#### Grafana

**Purpose:** Metrics visualization

**Pre-built dashboards:**
- Playbook generation rates
- Execution success/failure
- Error trends
- Performance metrics

---

## Data Flow

### Playbook Generation Flow

```
1. User sends natural language prompt
   │
   ▼
2. MCP Server receives request
   ├── Rate limit check
   ├── Authentication (if enabled)
   └── Input validation (Zod schemas)
   │
   ▼
3. AI Provider selection
   ├── Check if AI provider configured
   ├── Fallback to template if not
   └── Select appropriate model
   │
   ▼
4. Prompt enrichment
   ├── Load prompt template
   ├── Add few-shot examples
   ├── Add chain-of-thought hints
   └── Add context variables
   │
   ▼
5. AI generation (or template fallback)
   ├── Send to AI provider API
   ├── Parse YAML response
   └── Extract playbook content
   │
   ▼
6. Post-processing
   ├── Validate YAML syntax
   ├── Check for secrets
   ├── Add metadata comments
   └── Set file permissions (0600)
   │
   ▼
7. Save and respond
   ├── Write to /tmp/ansible-mcp/
   ├── Update metrics
   └── Return path and content
```

### Playbook Execution Flow

```
1. User requests execution
   │
   ▼
2. Pre-execution checks
   ├── Validate playbook path (security)
   ├── Validate inventory path
   └── Scan for hardcoded secrets
   │
   ▼
3. Build ansible-playbook command
   ├── Use execFile (not shell - security)
   ├── Sanitize tags and variables
   └── Set timeout (10 minutes default)
   │
   ▼
4. Execute playbook
   ├── Run against inventory
   ├── Stream output to logs
   └── Track duration
   │
   ▼
5. Process results
   ├── Parse stdout/stderr
   ├── Update metrics
   └── Return results
```

---

## MCP Protocol Integration

### Protocol Overview

MCP (Model Context Protocol) enables:
- Tool discovery by AI agents
- Structured tool invocation
- Typed parameters and responses

### Transport

```typescript
// Uses stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
```

**Why stdio?**
- Works with Claude Desktop
- Simple process communication
- No network configuration
- Easy debugging

### Tool Registration

```typescript
server.registerTool(
  'tool_name',
  {
    description: 'What it does',
    inputSchema: zodSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async (args) => handler(args)
);
```

### Tool Annotations

| Annotation | Purpose |
|------------|---------|
| `readOnlyHint` | Doesn't modify state |
| `destructiveHint` | Can cause data loss |
| `idempotentHint` | Safe to retry |

### Response Format

```typescript
return {
  content: [{
    type: 'text',
    text: JSON.stringify(data, null, 2)
  }],
  isError: false
};
```

---

## Security Architecture

### Defense in Depth

```
┌───────────────────────────────────────┐
│ Layer 1: Authentication               │
│ - API key validation                  │
│ - Rate limiting                       │
└───────────────────┬───────────────────┘
                    ▼
┌───────────────────────────────────────┐
│ Layer 2: Input Validation             │
│ - Zod schema validation               │
│ - Path traversal prevention           │
│ - Input sanitization                  │
└───────────────────┬───────────────────┘
                    ▼
┌───────────────────────────────────────┐
│ Layer 3: Execution Security           │
│ - execFile (not shell)                │
│ - Timeout enforcement                 │
│ - Secrets detection                   │
└───────────────────┬───────────────────┘
                    ▼
┌───────────────────────────────────────┐
│ Layer 4: Output Security              │
│ - File permissions (0600)             │
│ - Secrets warnings                    │
│ - Audit logging                       │
└───────────────────────────────────────┘
```

### Path Validation

```typescript
private validatePath(inputPath: string) {
  // Check for null bytes
  if (inputPath.includes('\0')) return invalid;

  // Resolve and normalize
  const resolved = path.resolve(path.normalize(inputPath));

  // Check against allowed paths
  const isAllowed = allowedPaths.some(allowed => {
    const relative = path.relative(allowed, resolved);
    return !relative.startsWith('..');
  });

  return isAllowed ? { valid: true, sanitizedPath: resolved } : invalid;
}
```

### Secrets Detection Patterns

```typescript
const secretPatterns = [
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/gi },
  { name: 'Password', pattern: /password['":\s]*['"]?([^'"}\s]{8,})/gi },
  { name: 'Private Key', pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/gi },
  { name: 'GitHub Token', pattern: /gh[ps]_[a-zA-Z0-9]{36}/gi },
  // ... more patterns
];
```

---

## Scalability Considerations

### Current Limitations

| Component | Limitation | Mitigation |
|-----------|------------|------------|
| MCP Server | Single process | Stateless, can run multiple |
| Redis | Single instance | Redis Cluster for HA |
| AI Providers | API rate limits | Multiple providers, caching |
| File Storage | Local disk | NFS or S3 for distributed |

### Scaling Strategies

#### Horizontal Scaling

```yaml
# docker-compose.override.yml
services:
  ansible-mcp:
    deploy:
      replicas: 3
```

**Requirements:**
- Shared Redis for state
- Load balancer in front
- Shared storage for playbooks

#### Caching Strategy

```typescript
// Check cache before AI generation
const cached = await redis.get(`playbook:${promptHash}`);
if (cached) return cached;

// Generate and cache
const playbook = await aiProvider.generate(prompt);
await redis.setex(`playbook:${promptHash}`, 3600, playbook);
```

#### Queue-Based Architecture (Future)

```
User Request
    │
    ▼
API Server ────► Redis Queue ────► Worker Processes
                                        │
                                        ▼
                                   AI Providers
```

**Benefits:**
- Handle burst traffic
- Retry failed jobs
- Priority queues
- Better resource utilization

---

## Design Decisions

### Why MCP over REST?

| Factor | MCP | REST |
|--------|-----|------|
| AI Integration | Native | Requires glue |
| Tool Discovery | Automatic | Manual docs |
| Typing | Strong (Zod) | OpenAPI |
| Transport | stdio | HTTP |

**Decision:** MCP for primary interface, REST possible via adapter

### Why TypeScript + Python?

**TypeScript (MCP Server):**
- Best MCP SDK support
- Strong async/await
- Type safety

**Python (AI Generator):**
- Native Ansible integration
- ML/AI ecosystem
- FastAPI for REST

**Decision:** Play to each language's strengths

### Why Template Fallback?

**Scenario:** AI provider unavailable or no API key

**Solution:** Template-based generation produces valid, if basic, playbooks

**Trade-off:** Less intelligent output vs. always available

---

## Future Architecture

### Planned Improvements

1. **Distributed Execution**
   - Worker pools for parallel execution
   - Job queue with Redis

2. **Enhanced Caching**
   - Semantic similarity matching
   - Reuse similar playbooks

3. **Multi-tenancy**
   - Isolated namespaces
   - Resource quotas
   - Billing integration

4. **Kubernetes Deployment**
   - Helm charts
   - Auto-scaling
   - Service mesh integration

---

**Architecture understood!** See [usage.md](usage.md) for practical workflows.
