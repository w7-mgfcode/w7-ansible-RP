# CLAUDE.md - AI Assistant Guide for Ansible MCP Server

## Project Overview

**Ansible MCP Server v2.0.0** - An AI-powered system that transforms natural language descriptions into production-ready Ansible playbooks using the Model Context Protocol (MCP).

**Key Characteristics:**
- **Type:** MCP Server + Web Management UI
- **Language:** TypeScript (Node.js) + Python + React
- **Architecture:** Microservices with Docker Compose
- **License:** MIT

This is NOT a traditional Ansible playbook repository. It's a platform that:
1. Generates Ansible playbooks from natural language prompts using AI
2. Validates generated playbooks for YAML/Ansible syntax errors
3. Executes playbooks against inventories
4. Manages playbooks and execution history via Web UI
5. Monitors operations with Prometheus metrics

## Repository Structure

```
/
├── README.md                    # Project overview
├── CHANGELOG.md                 # Version history (v0.1.0 → v2.0.0)
├── LICENSE                      # MIT License
│
├── docs/                        # Comprehensive documentation
│   ├── architecture.md          # System design and data flow
│   ├── configuration.md         # All configuration options
│   ├── installation.md          # Setup guide
│   ├── quickstart.md            # 5-minute quick start
│   ├── usage.md                 # Workflows and scenarios
│   ├── troubleshooting.md       # Problem solving guide
│   └── faq.md                   # FAQ
│
├── examples/                    # Reference examples
│   ├── configs/                 # Environment configs
│   ├── inventories/             # Sample inventories
│   └── playbooks/               # Example playbooks
│
├── scripts/
│   ├── common.sh                # Shared functions for all scripts
│   ├── install.sh               # Automated installation
│   ├── update.sh                # Incremental updates
│   └── manage.sh                # Unified management CLI
│
└── src/                         # Source code
    ├── ansible.cfg              # Ansible configuration
    ├── docker-compose.yml       # Service orchestration
    ├── Dockerfile.mcp           # MCP Server container
    ├── Dockerfile.python        # Python AI Generator container
    ├── package.json             # Node.js dependencies
    ├── requirements.txt         # Python dependencies
    │
    ├── server/                  # MCP Server (TypeScript/Python)
    │   ├── server.ts            # Main MCP server (2013 lines)
    │   ├── server.test.ts       # Jest tests (475 lines)
    │   ├── validation.ts        # Security & validation
    │   ├── prompt_templates.ts  # Prompt library (1831 lines)
    │   ├── playbook_generator.py # Python AI generation
    │   └── providers/           # AI Provider implementations
    │       ├── base.ts          # Abstract base class
    │       ├── openai.ts        # OpenAI integration
    │       ├── anthropic.ts     # Anthropic integration
    │       ├── gemini.ts        # Google Gemini integration
    │       ├── ollama.ts        # Ollama local integration
    │       └── factory.ts       # Provider factory pattern
    │
    ├── web-ui/                  # React Management Interface
    │   ├── backend/             # Express.js API Server
    │   │   └── src/
    │   │       ├── api/routes/  # API endpoints
    │   │       └── database/models/ # TypeORM entities
    │   └── frontend/            # React + Vite UI
    │       └── src/
    │           ├── pages/       # Dashboard, Playbooks, etc.
    │           └── components/  # Layout, Header, Sidebar
    │
    └── monitoring/              # Prometheus & Grafana configs
```

## Key Files Reference

| File | Purpose | When to Modify |
|------|---------|----------------|
| `src/server/server.ts` | Main MCP server, tool registration | Adding MCP tools |
| `src/server/validation.ts` | Security checks, path validation | Security updates |
| `src/server/prompt_templates.ts` | AI prompt templates | Adding templates |
| `src/server/providers/*.ts` | AI provider implementations | Adding providers |
| `src/docker-compose.yml` | Service orchestration | Infrastructure changes |
| `src/ansible.cfg` | Ansible behavior configuration | Execution tuning |
| `src/web-ui/backend/src/api/routes/` | REST API endpoints | API additions |
| `src/web-ui/frontend/src/pages/` | React page components | UI changes |

## Management CLI

The unified management CLI (`scripts/manage.sh`) provides all deployment operations:

### Installation & Updates
```bash
./scripts/manage.sh install [minimal|standard|full]  # Fresh installation
./scripts/manage.sh update                           # Incremental update
./scripts/manage.sh update --rebuild                 # Force rebuild all
./scripts/manage.sh update --backup                  # Backup before update
```

### Service Control
```bash
./scripts/manage.sh start [services]     # Start services
./scripts/manage.sh stop [services]      # Stop services
./scripts/manage.sh restart [services]   # Restart services
./scripts/manage.sh status               # Show status & resources
```

### Monitoring & Debugging
```bash
./scripts/manage.sh health               # Check all service health
./scripts/manage.sh logs [service] [-f]  # View logs
./scripts/manage.sh validate             # Validate configuration
./scripts/manage.sh shell <service>      # Open shell (psql/redis-cli)
```

### Backup & Restore
```bash
./scripts/manage.sh backup [dir]         # Create backup
./scripts/manage.sh restore <dir>        # Restore from backup
./scripts/manage.sh clean                # Remove all data
```

### Installation Types

| Type | Services | RAM |
|------|----------|-----|
| `minimal` | MCP + AI + Redis + Vault + Postgres | ~1GB |
| `standard` | + Web UI + Prometheus + Grafana | ~2GB |
| `full` | + GitLab | ~8GB |

## Development Commands

### TypeScript Server
```bash
npm run build      # Compile TypeScript
npm run start      # Run production server
npm run dev        # Development with hot reload
npm run test       # Run Jest tests
npm run lint       # Run ESLint
npm run format     # Format with Prettier
```

### Direct Docker Operations
```bash
docker compose up -d              # Start all services
docker compose down               # Stop all services
docker compose logs -f <service>  # View logs
docker compose build              # Rebuild images
```

### Python Components
```bash
pip install -r requirements.txt
python -m pytest src/server/      # Run tests
python -m black src/server/       # Format code
python -m mypy src/server/        # Type check
```

## Architecture Overview

### Services (docker-compose.yml)

| Service | Port | Purpose | Health Check |
|---------|------|---------|--------------|
| `web-ui` | 3001 | React management interface | `/api/health` |
| `ansible-mcp` | 3000 | Main MCP server | `/health` |
| `ai-generator` | 8000 | Python AI service | `/health` |
| `redis` | 6379 | Cache & job queue | `redis-cli ping` |
| `vault` | 8200 | Secrets management | `/v1/sys/health` |
| `postgres` | 5432 | Data persistence | `pg_isready` |
| `prometheus` | 9090 | Metrics collection | `/-/healthy` |
| `grafana` | 3002 | Dashboards | `/api/health` |

### Service Dependencies

All services have proper health check conditions:
```yaml
depends_on:
  postgres:
    condition: service_healthy
  redis:
    condition: service_healthy
```

This eliminates race conditions during startup - services wait for their dependencies to be healthy.

### AI Provider System

Supports multiple providers via factory pattern:
- **OpenAI** - gpt-4, gpt-4-turbo, gpt-3.5-turbo
- **Anthropic** - claude-3-opus, claude-3-sonnet, claude-3-haiku
- **Google Gemini** - gemini-pro, gemini-1.5-pro
- **Ollama** - llama2, mistral (local)

Configure via environment variables:
```bash
AI_PROVIDER=openai|anthropic|gemini|ollama
AI_MODEL=gpt-4
OPENAI_API_KEY=sk-...
```

### MCP Tools Available

| Tool | Purpose | Read-Only |
|------|---------|-----------|
| `generate_playbook` | Create from natural language | No |
| `validate_playbook` | Check YAML & Ansible syntax | Yes |
| `run_playbook` | Execute against inventory | No |
| `refine_playbook` | Improve based on feedback | No |
| `lint_playbook` | Check best practices | Yes |
| `list_prompt_templates` | Browse templates | Yes |
| `get_prompt_template` | Get template details | Yes |
| `enrich_prompt` | Add few-shot examples | Yes |
| `generate_with_template` | Use optimized prompt | No |

## Code Conventions

### TypeScript/JavaScript

**File Naming:**
- Source files: camelCase (`server.ts`, `validation.ts`)
- React components: PascalCase (`Header.tsx`, `Dashboard.tsx`)
- Config files: kebab-case (`tsconfig.json`)

**Naming Patterns:**
```typescript
// Classes: PascalCase
class PromptTemplateLibrary {}
class OpenAIProvider {}

// Constants: UPPER_SNAKE_CASE
const DEFAULT_ALLOWED_PATHS = ['/tmp/ansible-mcp']
const SECRET_PATTERNS = [...]

// Functions: camelCase
function validatePath() {}
async function generatePlaybook() {}

// Interfaces: PascalCase with descriptive suffixes
interface PathValidationResult {}
interface AIGenerationOptions {}
```

**Imports Order:**
1. External packages
2. Internal modules
3. Relative imports
4. Type imports

### Python

```python
# File naming: snake_case
playbook_generator.py

# Classes: PascalCase
class PlaybookGenerator:
    pass

# Constants: UPPER_SNAKE_CASE
RESPONSES_API_MODELS = [...]

# Enums: PascalCase class, snake_case values
class PlaybookType(Enum):
    KUBERNETES = "kubernetes"
```

### React/Frontend

```tsx
// Functional components with named export
export function Dashboard() {
  return <div className="...">...</div>
}

// Props interfaces
interface DashboardProps {
  onRefresh?: () => void
}

// Tailwind CSS utility classes
<div className="flex items-center justify-between gap-4 p-4">
```

## Security Patterns

### Path Validation (CRITICAL)
```typescript
// Always validate paths before file operations
import { validatePath } from './validation.js'

const validation = validatePath(path, securityConfig.allowedPaths)
if (!validation.valid) {
  return { isError: true, content: [{ type: 'text', text: validation.error }] }
}
```

**Allowed directories:** `/tmp/ansible-mcp`, `/workspace/playbooks`

### Secrets Detection
The system detects 10 secret patterns:
- AWS keys (AKIA...)
- API keys
- Private keys
- GitHub/Slack tokens
- JWTs
- Generic secrets

### Rate Limiting
Default: 100 requests/minute per client (configurable)

### Command Injection Prevention
Always use `execFile` with argument arrays, never shell interpolation.

## MCP Tool Registration Pattern

```typescript
// In server.ts: registerTools() method
mcp.tool('tool_name', {
  description: 'What it does',
  inputSchema: z.object({
    param1: z.string().describe('Parameter description'),
    param2: z.boolean().optional().describe('Optional param')
  }).describe('Input parameters')
}, async (params) => {
  // 1. Validate security
  const validation = validatePath(params.path, securityConfig.allowedPaths)
  if (!validation.valid) {
    return { isError: true, content: [{ type: 'text', text: validation.error }] }
  }

  // 2. Execute logic
  const result = await executeLogic(params)

  // 3. Record metrics
  metrics.counter.inc({ label: value })

  // 4. Return MCP-compliant response
  return {
    isError: false,
    content: [{ type: 'text', text: JSON.stringify(result) }]
  }
})
```

## Error Handling Pattern

```typescript
try {
  const result = await operation()
  return {
    isError: false,
    content: [{ type: 'text', text: JSON.stringify(result) }]
  }
} catch (error) {
  logger.error('Operation failed', { error })
  metrics.errors.inc()
  return {
    isError: true,
    content: [{ type: 'text', text: error.message }]
  }
}
```

## Logging Pattern

Use Winston logger with structured JSON:
```typescript
logger.info('Operation started', { playbookId, userId })
logger.warn('Security concern', { detectedSecrets: ['API Key'] })
logger.error('Critical failure', { error, code, stack })
```

## Metrics Recording

```typescript
// Counters
metrics.playbooksGenerated.inc({ template: 'kubernetes', status: 'success' })
metrics.secretsDetected.inc()

// Histograms
metrics.executionDuration.observe(elapsedSeconds)
```

## Database Models (TypeORM)

**Core Entities:**
- `User` - Authentication, roles (admin/user/viewer)
- `Playbook` - Generated playbooks, validation status
- `Execution` - Execution history, output, duration
- `Job` - Job queue (generation/execution/validation)

## Testing

### Jest Tests (`src/server/server.test.ts`)

Categories:
1. Security tests (path traversal, secrets detection)
2. Validation tests (size limits, YAML parsing)
3. Integration tests (providers, templates)

Run tests:
```bash
npm test
```

## Environment Configuration

### Required Variables
```bash
JWT_SECRET=<generate with: openssl rand -base64 32>
POSTGRES_PASSWORD=<strong password>
POSTGRES_USER=ansible_mcp
```

### AI Provider
```bash
AI_PROVIDER=openai
AI_MODEL=gpt-4
OPENAI_API_KEY=sk-...
# Or for other providers:
# ANTHROPIC_API_KEY=sk-ant-...
# GEMINI_API_KEY=...
# AI_BASE_URL=http://localhost:11434 (for Ollama)
```

### Optional
```bash
LOG_LEVEL=info|debug|warn|error
VAULT_ROOT_TOKEN=<vault token>
MCP_API_KEY=<api key for MCP auth>
```

## Common Workflows

### Adding a New MCP Tool

1. Open `src/server/server.ts`
2. Find `registerTools()` method
3. Add tool using the pattern above
4. Add validation in `validation.ts` if needed
5. Add tests in `server.test.ts`
6. Update metrics if applicable

### Adding a New AI Provider

1. Create `src/server/providers/newprovider.ts`
2. Extend `AIProvider` base class
3. Implement `generate()`, `generatePlaybook()`, `test()`
4. Register in `factory.ts`
5. Add environment variables to documentation

### Adding a Prompt Template

1. Open `src/server/prompt_templates.ts`
2. Add template following `PromptTemplate` interface
3. Include system prompt, user template, few-shot examples
4. Register in `DEFAULT_TEMPLATES` array

### Adding a Web UI Page

1. Create component in `src/web-ui/frontend/src/pages/`
2. Add route in `App.tsx`
3. Add navigation item in `Sidebar.tsx`
4. Create backend routes if needed in `src/web-ui/backend/src/api/routes/`

### Adding an API Endpoint

1. Create/modify route file in `src/web-ui/backend/src/api/routes/`
2. Add authentication middleware if needed
3. Add validation using express-validator
4. Register in Express app

## Important Notes for AI Assistants

### DO:
- Always validate paths before file operations
- Use the established patterns for error handling
- Record metrics for observability
- Follow the naming conventions
- Write tests for new functionality
- Use TypeScript strict mode
- Sanitize user inputs

### DON'T:
- Skip path validation (security risk)
- Use shell interpolation in commands (injection risk)
- Commit secrets or API keys
- Ignore the rate limiter
- Break MCP protocol compliance
- Use deprecated Ansible modules (apt_key, apt_repository)

### Security Checklist:
- [ ] Path validation for all file operations
- [ ] No secrets in code or configs
- [ ] Input sanitization for user data
- [ ] Rate limiting applied
- [ ] Proper error messages (no stack traces to users)
- [ ] Metrics recorded for monitoring

## Version History

- **v2.0.0** (Nov 2025) - Current: Full MCP compliance, multi-provider AI, Web UI, security features
- **v1.0.0** (Oct 2025) - Core MCP server, basic generation and validation
- **v0.1.0** (Sep 2025) - Initial release, proof of concept

## Getting Started

### Quick Installation
```bash
# 1. Run install script
chmod +x scripts/install.sh
./scripts/manage.sh install standard

# 2. Add AI API key
nano .env  # Set OPENAI_API_KEY=sk-...

# 3. Restart MCP server
./scripts/manage.sh restart ansible-mcp

# 4. Verify
./scripts/manage.sh health
```

### Learning Path
1. Read `README.md` for overview
2. Follow `docs/quickstart.md` for setup
3. Study `docs/architecture.md` for system design
4. Review `src/server/server.ts` for tool patterns
5. Check `examples/` for reference implementations
6. Access Web UI at `http://localhost:3001`

### Updating Existing Installation
```bash
# Pull latest changes
git pull

# Update with incremental rebuild
./scripts/manage.sh update

# Or force full rebuild
./scripts/manage.sh update --rebuild --backup
```

## Deployment Troubleshooting - Common Issues & Solutions

This section documents deployment issues discovered during testing and their solutions.

### Issue 1: TypeScript Build Path Mismatch

**Symptom:** `error TS18003: No inputs were found in config file`

**Cause:** Dockerfile.mcp copied `server/` to `./src/` but tsconfig.json expects files in `server/**/*.ts`

**Solution:** In `src/Dockerfile.mcp`, change:
```dockerfile
# Wrong
COPY server/ ./src/

# Correct
COPY server/ ./server/
```

### Issue 2: MCP Server dist Path

**Symptom:** `Cannot find module '/workspace/dist/server.js'`

**Cause:** TypeScript compiles `server/server.ts` to `dist/server/server.js` (mirrors directory structure)

**Solution:** In `src/Dockerfile.mcp`, change CMD:
```dockerfile
# Wrong
CMD ["node", "dist/server.js"]

# Correct
CMD ["node", "dist/server/server.js"]
```

### Issue 3: AI Generator Module Import Error

**Symptom:** `Could not import module "src.api"`

**Cause:** docker-compose.yml mounted `./src:/app/src` which overwrote Dockerfile's setup. The actual file is at `./server/api.py`

**Solution:** In `src/docker-compose.yml` for ai-generator service:
```yaml
volumes:
  # Wrong
  - ./src:/app/src

  # Correct
  - ./server:/app/src
```

### Issue 4: PostgreSQL User Mismatch

**Symptom:** `password authentication failed for user "awx"`

**Cause:** web-ui defaulted to `awx` user while postgres defaulted to `ansible_mcp`

**Solution:** In `src/docker-compose.yml` for web-ui service:
```yaml
environment:
  # Wrong
  - DB_USER=${POSTGRES_USER:-awx}

  # Correct
  - DB_USER=${POSTGRES_USER:-ansible_mcp}
```

**Note:** If postgres volume already exists with old credentials, delete it:
```bash
docker volume rm src_postgres-data
```

### Issue 5: MCP Server Health Check Port

**Symptom:** MCP Server shows "unhealthy" but actually works

**Cause:**
- Health check used port 3000 but MCP server uses stdio (no HTTP on 3000)
- The `/health` endpoint is on the metrics server (port 9090)

**Solution:** In `src/docker-compose.yml` for ansible-mcp service:
```yaml
healthcheck:
  # Wrong
  test: ["CMD", "curl", "-f", "http://localhost:3000/health"]

  # Correct
  test: ["CMD", "curl", "-f", "http://localhost:9090/health"]
```

Also update `src/Dockerfile.mcp`:
```dockerfile
EXPOSE 3000 9090

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9090/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"
```

### Issue 6: Vault Dependency Blocking MCP Server

**Symptom:** `dependency failed to start: container ansible-vault is unhealthy`

**Cause:** Vault health check is too strict/slow in dev mode, but Vault actually works

**Workaround:** Manually start MCP server after other services:
```bash
docker compose -f src/docker-compose.yml up -d
docker start ansible-mcp-server
```

### Issue 7: manage.sh Shows "MCP Server not responding"

**Symptom:** `[WARN] MCP Server (3000) - not responding`

**This is expected behavior!** The MCP protocol uses stdio, not HTTP on port 3000. The actual health endpoint is on port 9090 (metrics server).

To verify MCP Server health:
```bash
docker exec ansible-mcp-server wget -qO- http://localhost:9090/health
```

### Port Architecture Summary

| Service | External Port | Internal Port | Protocol |
|---------|--------------|---------------|----------|
| MCP Server | 3000 | 3000 | MCP (stdio) |
| MCP Health | - | 9090 | HTTP |
| Prometheus | 9090 | 9090 | HTTP |
| Web UI | 3001 | 3001 | HTTP |
| AI Generator | 8000 | 8000 | HTTP |

### Deployment Checklist

After fresh installation, verify:
```bash
# All containers running
docker ps

# Health checks passing
./scripts/manage.sh health

# MCP Server internal health
docker exec ansible-mcp-server wget -qO- http://localhost:9090/health

# Web UI accessible
curl http://localhost:3001/api/health
```

## Support & Resources

- Documentation: `docs/` directory
- Examples: `examples/` directory
- Tests: `src/server/server.test.ts`
- Troubleshooting: `docs/troubleshooting.md`
- FAQ: `docs/faq.md`
