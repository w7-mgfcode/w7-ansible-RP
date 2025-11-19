# Ansible MCP Server - Release Package

> AI-Powered Ansible Playbook Generation using Model Context Protocol

[![Version](https://img.shields.io/badge/Version-2.0.0-blue)](https://github.com/w7-mgfcode/Mannos-ANSIBLE_MCP-solution)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-v1.22.0-purple)](https://modelcontextprotocol.io)

---

## Overview

Transform natural language descriptions into production-ready Ansible playbooks. This MCP server integrates with AI agents to automate infrastructure provisioning and configuration management.

**Key Features:**
- 🤖 AI-powered playbook generation (OpenAI, Anthropic, Gemini, Ollama)
- ✅ Built-in validation and linting
- 📚 Optimized prompt templates with few-shot learning
- 🔐 Security hardening with secrets detection
- 📊 Prometheus metrics and Grafana dashboards
- 🐳 Fully containerized deployment

---

## Quick Start

### Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- Git

### Installation (5 minutes)

```bash
# 1. Clone and enter directory
git clone https://github.com/w7-mgfcode/Mannos-ANSIBLE_MCP-solution.git
cd Mannos-ANSIBLE_MCP-solution

# 2. Run install script
chmod +x scripts/*.sh
./scripts/manage.sh install standard

# 3. Add your AI API key to .env
nano .env  # Set OPENAI_API_KEY=sk-your-key

# 4. Restart to apply
./scripts/manage.sh restart ansible-mcp

# 5. Verify health
./scripts/manage.sh health
```

### Generate Your First Playbook

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "generate_playbook",
    "arguments": {
      "prompt": "Install and configure nginx with SSL"
    }
  }' | jq
```

---

## Package Contents

```text
release-package/
├── src/                    # Source files
│   ├── server/             # TypeScript MCP server
│   ├── web-ui/             # React management interface
│   ├── monitoring/         # Prometheus/Grafana configs
│   ├── docker-compose.yml  # Service orchestration
│   └── *.Dockerfile        # Container definitions
│
├── docs/                   # Documentation
│   ├── installation.md     # Complete setup guide
│   ├── quickstart.md       # Fast path to working setup
│   ├── configuration.md    # All config options
│   ├── architecture.md     # System design
│   ├── usage.md            # Common workflows
│   ├── troubleshooting.md  # Problem solving
│   └── faq.md              # Common questions
│
├── examples/               # Ready-to-use examples
│   ├── configs/            # Environment templates
│   ├── playbooks/          # Sample playbooks
│   └── inventories/        # Inventory examples
│
├── scripts/                # Automation scripts
│   ├── common.sh           # Shared functions
│   ├── install.sh          # Fresh installation
│   ├── update.sh           # Incremental updates
│   └── manage.sh           # Unified management CLI
│
├── README.md               # This file
├── CHANGELOG.md            # Version history
└── LICENSE                 # MIT License
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [installation.md](docs/installation.md) | Prerequisites, step-by-step setup |
| [quickstart.md](docs/quickstart.md) | Fastest path to working system |
| [configuration.md](docs/configuration.md) | All configuration options |
| [architecture.md](docs/architecture.md) | System design and data flow |
| [usage.md](docs/usage.md) | Common workflows and examples |
| [troubleshooting.md](docs/troubleshooting.md) | Problem solving guide |
| [faq.md](docs/faq.md) | Frequently asked questions |

---

## MCP Tools

| Tool | Purpose |
|------|---------|
| `generate_playbook` | Create playbook from natural language |
| `validate_playbook` | Check YAML and Ansible syntax |
| `run_playbook` | Execute against inventory |
| `refine_playbook` | Improve based on feedback |
| `lint_playbook` | Check best practices |
| `list_prompt_templates` | Browse available templates |
| `generate_with_template` | Use optimized prompts |

---

## Management CLI

Unified CLI for all deployment operations:

```bash
# Installation
./scripts/manage.sh install [minimal|standard|full]

# Incremental updates (only rebuilds changed services)
./scripts/manage.sh update
./scripts/manage.sh update --rebuild --backup

# Service control
./scripts/manage.sh start [services]
./scripts/manage.sh stop [services]
./scripts/manage.sh restart [services]
./scripts/manage.sh status
./scripts/manage.sh logs [service] -f

# Health & debugging
./scripts/manage.sh health
./scripts/manage.sh validate
./scripts/manage.sh shell postgres  # psql shell

# Backup & restore
./scripts/manage.sh backup [dir]
./scripts/manage.sh restore <dir>
```

---

## Services

| Service | Port | Description |
|---------|------|-------------|
| MCP Server | 3000 | Main API endpoint |
| Metrics | 9090 | Prometheus metrics |
| Web UI | 3001 | Management interface |
| Grafana | 3002 | Dashboards |
| Redis | 6379 | Cache |
| Vault | 8200 | Secrets |
| PostgreSQL | 5432 | Database |

---

## Requirements

### System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 4 GB | 8 GB |
| Storage | 20 GB | 50 GB |

### Software Requirements

| Software | Version |
|----------|---------|
| Docker | 20.10+ |
| Docker Compose | 2.0+ |
| Node.js (dev only) | 20+ |
| Python (dev only) | 3.10+ |

---

## AI Provider Support

| Provider | Models | API Key Variable |
|----------|--------|------------------|
| OpenAI | GPT-4, GPT-3.5 | `OPENAI_API_KEY` |
| Anthropic | Claude 3 | `ANTHROPIC_API_KEY` |
| Google | Gemini Pro | `GEMINI_API_KEY` |
| Ollama | Llama 3, Mistral | Local, no key |

---

## Security Features

- 🔐 Path traversal prevention
- 🔍 Secrets detection (AWS keys, passwords, tokens)
- ⏱️ Rate limiting (100 req/min default)
- 📁 Secure file permissions (0600)
- 🛡️ Input sanitization
- 🔒 JWT authentication for Web UI

---

## Support

### Getting Help

1. Check [troubleshooting.md](docs/troubleshooting.md)
2. Read [faq.md](docs/faq.md)
3. Open issue: https://github.com/w7-mgfcode/Mannos-ANSIBLE_MCP-solution/issues

### Contributing

See the main repository for contribution guidelines.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io) - MCP specification
- [Ansible](https://www.ansible.com) - Infrastructure automation
- All contributors and users

---

**Ready to get started?** See [docs/quickstart.md](docs/quickstart.md) for the fastest path to your first playbook!
