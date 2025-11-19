# Changelog

All notable changes to Ansible MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.1] - 2025-11-19

### Fixed

**Security Improvements**
- Removed insecure default passwords from docker-compose.yml (GitLab, Grafana)
- Removed weak default password from PostgreSQL template
- Added path re-validation in playbook update/delete operations
- Added authorization check for job detail endpoint
- Fixed options spread order in AI provider base to prevent undefined overriding defaults

**Code Quality**
- Fixed type consistency in execution stats (return numbers not strings)
- Added state reset in useExecutionStream when executionId changes
- Used consistent undefined checks for playbook update fields
- Imported NextFunction type in templates.ts routes
- Added environment variable override for Anthropic models list
- Updated Anthropic model list to current API identifiers
- Optimized queue stats query to use single GROUP BY
- Added status filter validation against ExecutionStatus enum
- Added template variables validation in enrich endpoint
- Added password strength validation in Settings.tsx
- Ensured directory exists before saveTemplate writes

**Architecture**
- Created WebSocketContext for centralized WebSocket connection
- Exported wsManager via getter function to prevent reassignment

**Documentation**
- Documented execution cancellation limitation with TODO
- Added SECURITY comment for required password variables

---

## [2.0.0] - 2025-11-18

### Added

**MCP Protocol Compliance**
- Full MCP 2025-03-26 specification compliance
- Tool annotations (readOnlyHint, destructiveHint, idempotentHint)
- McpServer high-level API usage
- Server capabilities with listChanged support
- Server instructions for client guidance

**Security Features**
- Command injection protection using execFile with argument arrays
- Path traversal prevention with allowed directory validation
- Secrets detection (AWS keys, passwords, tokens, private keys)
- Rate limiting (100 requests/minute default)
- Secure file permissions (0600) for generated playbooks
- Input sanitization for tags and user inputs

**Infrastructure Integration**
- HashiCorp Vault integration for secrets management
- Redis connection pooling and caching
- Prometheus metrics (7 custom metrics)
- Health check endpoint (/health)
- Metrics endpoint (/metrics)
- Winston structured JSON logging

**AI Provider System**
- Multi-provider support (OpenAI, Anthropic, Gemini, Ollama)
- Provider factory pattern for easy switching
- Graceful fallback to templates when AI unavailable
- Configurable models per provider

**Prompt Template Library**
- Few-shot learning examples
- Chain-of-thought reasoning patterns
- Context enrichment with best practices
- Template versioning and changelog
- 8 template categories

**Testing Infrastructure**
- Jest tests for TypeScript
- Pytest suite for Python
- Security tests (path validation, secrets detection)
- Integration tests

### Changed

- Upgraded MCP SDK from 1.0.0 to 1.22.0
- Migrated to McpServer high-level API from low-level Server
- Improved error handling with isError flag in CallToolResult
- Enhanced playbook validation with best practices warnings
- Better logging with Winston JSON format

### Fixed

- Race conditions in async operations
- Memory leaks in long-running connections
- Proper cleanup on SIGINT/SIGTERM
- Redis reconnection handling

---

## [1.0.0] - 2025-10-01

### Added

**Core Features**
- Basic MCP server implementation
- Playbook generation from prompts
- YAML validation
- Ansible syntax checking
- Playbook execution
- Playbook refinement

**Templates**
- Kubernetes deployment template
- Docker setup template
- System hardening template

**Infrastructure**
- Docker Compose setup
- Basic monitoring (Prometheus)
- PostgreSQL for storage

### Technical

- TypeScript/Node.js server
- Python playbook generator
- Zod schema validation
- js-yaml parsing

---

## [0.1.0] - 2025-09-01

### Added

- Initial project setup
- Basic MCP protocol implementation
- Proof of concept playbook generation
- Development environment configuration

---

## Future Roadmap

### Planned for v2.1.0

- [ ] Kubernetes deployment with Helm charts
- [ ] Enhanced caching with semantic similarity
- [ ] Job queue for async execution
- [ ] Multi-tenancy support
- [ ] RBAC improvements

### Planned for v3.0.0

- [ ] Visual playbook editor
- [ ] Ansible role generation
- [ ] Test generation (Molecule)
- [ ] Cost estimation for cloud resources
- [ ] Compliance reporting

---

## Upgrade Notes

### From 1.x to 2.x

1. **Environment variables**: New required variables
   - `JWT_SECRET` (required for Web UI)
   - `AI_PROVIDER` (optional, defaults to openai)

2. **Docker Compose**: Service names changed
   - `mcp-server` → `ansible-mcp`

3. **API changes**: Response format updated
   - All errors now include `isError: true`
   - Secrets warnings in generation response

4. **Configuration**: Security defaults changed
   - Rate limiting enabled by default
   - Path validation stricter

### Migration Steps

```bash
# 1. Backup existing data
docker compose down
cp -r playbooks playbooks.backup
cp .env .env.backup

# 2. Pull new version
git pull origin main

# 3. Update .env with new variables
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env

# 4. Rebuild and restart
docker compose build
docker compose up -d

# 5. Verify
curl http://localhost:9090/health
```

---

## Links

- [GitHub Repository](https://github.com/w7-mgfcode/Mannos-ANSIBLE_MCP-solution)
- [Documentation](docs/)
- [Issue Tracker](https://github.com/w7-mgfcode/Mannos-ANSIBLE_MCP-solution/issues)
