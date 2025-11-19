# Frequently Asked Questions

> Anticipated questions with clear answers

---

## General Questions

### What is Ansible MCP Server?

An AI-powered system that converts natural language descriptions into production-ready Ansible playbooks. It uses the Model Context Protocol (MCP) to integrate with AI agents like Claude.

### What problems does it solve?

- **Manual playbook writing** - Automates YAML creation
- **Inconsistent quality** - Built-in validation and best practices
- **Slow iteration** - Quick generation and refinement
- **Knowledge gaps** - AI knows Ansible best practices

### Do I need an AI API key?

**No, but recommended.**

- Without AI: Uses built-in templates (basic but valid)
- With AI: Contextual, intelligent playbook generation

### Which AI providers are supported?

| Provider | Models | Notes |
|----------|--------|-------|
| OpenAI | GPT-4, GPT-3.5 | Best overall quality |
| Anthropic | Claude 3 family | Excellent reasoning |
| Google | Gemini Pro/Flash | Good value |
| Ollama | Llama, Mistral | Local, free, private |

---

## Installation Questions

### Can I run without Docker?

**Yes**, but Docker is recommended.

Manual setup requires:
- Node.js 20+
- Python 3.10+
- Ansible 2.15+
- Redis
- PostgreSQL (optional)

See [installation.md](installation.md) for manual steps.

### How much disk space do I need?

| Configuration | Space Needed |
|---------------|--------------|
| Minimal (MCP + Redis) | ~2 GB |
| Standard (+ Prometheus, Grafana) | ~5 GB |
| Full (+ GitLab, AWX) | ~15 GB |

### Can I run on Windows?

**Yes**, with WSL2 + Docker Desktop.

1. Install WSL2: `wsl --install`
2. Install Docker Desktop
3. Enable WSL2 integration
4. Clone and run in WSL2 terminal

### How do I update to a new version?

```bash
# Pull latest code
git pull origin main

# Rebuild containers
docker compose down
docker compose build
docker compose up -d
```

---

## Usage Questions

### How do I write good prompts?

**Be specific:**
```bash
# Good
"Deploy nginx as reverse proxy with SSL termination,
rate limiting (100 req/s), proxy_pass to localhost:8080,
enable gzip compression, configure log rotation"

# Bad
"setup nginx"
```

**Include:**
- Specific software versions
- Security requirements
- Performance parameters
- Target environment

### What's the difference between `generate_playbook` and `generate_with_template`?

| Feature | generate_playbook | generate_with_template |
|---------|-------------------|------------------------|
| Uses AI | Yes | Yes |
| Few-shot examples | No | Yes |
| Best practices injection | Basic | Comprehensive |
| Template versioning | No | Yes |
| Recommended for | Quick tasks | Production workloads |

### Can I use my own templates?

**Yes**, two ways:

1. **Built-in templates**: Add to `loadTemplates()` in `src/server.ts`
2. **Prompt templates**: Use `update_template_version` tool

### How do I handle sensitive data?

**Never hardcode secrets.** Use:

1. **Ansible Vault:**
```yaml
password: "{{ vault_database_password }}"
```

2. **Environment variables:**
```yaml
password: "{{ lookup('env', 'DB_PASSWORD') }}"
```

3. **HashiCorp Vault:**
```yaml
password: "{{ lookup('hashi_vault', 'secret/db:password') }}"
```

### Can I execute playbooks against real servers?

**Yes**, but:
1. Always dry-run first (`check_mode: true`)
2. Start with non-production
3. Use limited tags for incremental changes
4. Have rollback plan

---

## Configuration Questions

### Which AI provider is best?

| Need | Recommendation |
|------|----------------|
| Best quality | OpenAI GPT-4 or Claude 3 Opus |
| Best value | Gemini Flash or GPT-3.5-turbo |
| Privacy/local | Ollama with Llama 3.2 |
| Fastest | Claude 3 Haiku or Gemini Flash |

### What's JWT_SECRET and why is it required?

JWT_SECRET signs authentication tokens for the web UI. Without it:
- Web UI won't start
- Authentication fails

Generate with:
```bash
openssl rand -base64 32
```

### How do I change the default ports?

Edit `docker-compose.yml`:
```yaml
services:
  ansible-mcp:
    ports:
      - "3001:3000"  # Host:Container
```

### Can I use an external database?

**Yes**, set environment variables:
```bash
DB_HOST=your-postgres-server.com
DB_PORT=5432
DB_USER=ansible_mcp
DB_PASSWORD=secure-password
```

---

## Security Questions

### Is it safe for production?

**Yes**, with proper configuration:
- Enable authentication (`MCP_ENABLE_AUTH=true`)
- Use strong passwords
- Configure TLS/HTTPS
- Run in isolated network
- Enable secrets detection

### What secrets are detected?

- AWS credentials (AKIA...)
- Private keys
- API tokens (GitHub, Slack)
- Passwords
- JWTs

### Can I disable secrets detection?

Not recommended, but you can modify `secretPatterns` in `src/server.ts`.

### How does rate limiting work?

Default: 100 requests per minute per client

If exceeded, wait 1 minute or increase limit.

---

## Troubleshooting Questions

### Why is generation falling back to templates?

AI provider not configured or API error. Check:
```bash
docker compose logs ansible-mcp | grep -i "AI Provider"
```

### Why is my playbook failing validation?

Common causes:
- YAML indentation errors
- Missing required fields (name, hosts)
- Invalid module parameters

Use `refine_playbook` to fix.

### Why can't I connect to Redis/Vault?

1. Service not started
2. Wrong host/port
3. Network issues

See [troubleshooting.md](troubleshooting.md) for solutions.

### How do I view detailed logs?

```bash
# Set debug level
LOG_LEVEL=debug

# Restart
docker compose restart ansible-mcp

# View logs
docker compose logs -f ansible-mcp
```

---

## Integration Questions

### Can I use this with Claude Desktop?

**Yes**, add to Claude Desktop config:
```json
{
  "mcpServers": {
    "ansible": {
      "command": "node",
      "args": ["/path/to/dist/server.js"]
    }
  }
}
```

### Can I use this in CI/CD pipelines?

**Yes**, use curl or scripts:
```bash
curl -X POST http://ansible-mcp:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"tool": "generate_playbook", ...}'
```

### Is there a Python SDK?

Not official, but you can use:
```python
import requests
result = requests.post(
    "http://localhost:3000/execute",
    json={"tool": "generate_playbook", "arguments": {...}}
)
```

### Can I run multiple instances?

**Yes**, for scaling:
- Use shared Redis
- Load balancer in front
- Shared storage for playbooks

---

## Performance Questions

### How fast is playbook generation?

| Method | Typical Time |
|--------|--------------|
| Template only | < 1 second |
| AI (GPT-3.5) | 2-5 seconds |
| AI (GPT-4) | 5-15 seconds |
| AI (local Ollama) | 3-10 seconds |

### How can I speed up generation?

1. Use faster model (GPT-3.5 vs GPT-4)
2. Use templates for common tasks
3. Use local Ollama model
4. Enable Redis caching

### What are the resource requirements?

| Configuration | RAM | CPU |
|---------------|-----|-----|
| Minimal | 2 GB | 2 cores |
| Recommended | 4 GB | 4 cores |
| Full stack | 8 GB | 4+ cores |

---

## Comparison Questions

### How is this different from Ansible Tower/AWX?

| Feature | MCP Server | AWX |
|---------|------------|-----|
| Playbook generation | AI-powered | Manual |
| Natural language | Yes | No |
| Web UI | Basic | Full-featured |
| Job scheduling | No | Yes |
| RBAC | Basic | Advanced |

They're complementary - MCP generates, AWX manages.

### How is this different from writing playbooks manually?

| Aspect | Manual | MCP Server |
|--------|--------|------------|
| Speed | Hours | Minutes |
| Consistency | Variable | Standardized |
| Best practices | Depends on author | Built-in |
| Learning curve | High | Low |

### Is AI-generated code reliable?

**Generally yes**, but:
- Always validate generated playbooks
- Always dry-run before production
- Review security-critical tasks
- AI can make mistakes - human oversight required

---

## Licensing Questions

### What license is this under?

MIT License - free for commercial and personal use.

### Can I modify the code?

Yes, MIT license allows modification. Consider contributing back!

### Can I sell solutions built on this?

Yes, MIT license allows commercial use.

---

## Getting Help

### Where do I report bugs?

https://github.com/w7-mgfcode/Mannos-ANSIBLE_MCP-solution/issues

### Where can I get support?

1. Check documentation in `docs/`
2. Search existing issues
3. Open new issue with details

### How can I contribute?

See CONTRIBUTING.md:
- Bug reports
- Feature requests
- Pull requests
- Documentation improvements

---

**Question not answered?** Open an issue with your question!
