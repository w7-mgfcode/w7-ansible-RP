# Ansible MCP Web Management Interface

A comprehensive web-based management interface for the Ansible MCP Server.

## Features

- **Dashboard**: Overview with metrics, recent executions, and system health
- **Playbook Management**: Create, edit, validate, lint, and execute playbooks
- **AI-Powered Generation**: Generate playbooks from natural language prompts
- **Execution Monitoring**: Real-time execution tracking with WebSocket updates
- **Template Library**: Pre-built templates for common infrastructure tasks
- **Job Queue**: Monitor background jobs (generate, validate, lint, refine, execute)
- **User Authentication**: JWT-based auth with role-based access control
- **Settings**: User profile, security, notifications, and appearance settings

## Architecture

```
web-ui/
├── backend/                # Express.js REST API
│   ├── src/
│   │   ├── api/
│   │   │   ├── routes/     # API endpoints
│   │   │   ├── middleware/ # Auth, error handling
│   │   │   └── websocket/  # Real-time updates
│   │   ├── database/
│   │   │   └── models/     # TypeORM entities
│   │   └── index.ts        # Main server
│   └── package.json
│
└── frontend/               # React + Vite
    ├── src/
    │   ├── components/     # Reusable UI components
    │   ├── pages/          # Page components
    │   ├── hooks/          # Custom React hooks
    │   ├── lib/            # API client, stores
    │   └── styles/         # TailwindCSS
    └── package.json
```

## Tech Stack

### Backend
- **Express.js**: REST API server
- **TypeORM**: PostgreSQL ORM
- **WebSocket (ws)**: Real-time updates
- **JWT**: Authentication
- **bcryptjs**: Password hashing

### Frontend
- **React 18**: UI framework
- **Vite**: Build tool
- **TailwindCSS**: Styling
- **React Query**: Data fetching
- **Zustand**: State management
- **React Router**: Navigation

## Quick Start

### Development

```bash
# Backend
cd backend
npm install
npm run dev

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

### Docker

```bash
# From project root
docker compose up web-ui -d
```

Access at: http://localhost:3001

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout
- `PUT /api/auth/password` - Change password

### Playbooks
- `GET /api/playbooks` - List playbooks
- `POST /api/playbooks` - Create playbook
- `GET /api/playbooks/:id` - Get playbook
- `PUT /api/playbooks/:id` - Update playbook
- `DELETE /api/playbooks/:id` - Delete playbook
- `POST /api/playbooks/generate` - Generate from prompt
- `POST /api/playbooks/:id/validate` - Validate
- `POST /api/playbooks/:id/execute` - Execute
- `POST /api/playbooks/:id/lint` - Run linter
- `POST /api/playbooks/:id/refine` - Refine with feedback

### Executions
- `GET /api/executions` - List executions
- `GET /api/executions/:id` - Get execution
- `GET /api/executions/:id/output` - Get output
- `POST /api/executions/:id/stop` - Stop execution
- `GET /api/executions/stats/summary` - Statistics

### Templates
- `GET /api/templates` - List templates
- `GET /api/templates/:id` - Get template
- `POST /api/templates/:id/enrich` - Enrich prompt

### Jobs
- `GET /api/jobs` - List jobs
- `GET /api/jobs/:id` - Get job
- `POST /api/jobs/:id/cancel` - Cancel job

## WebSocket

Connect to `ws://localhost:3001/ws`

### Channels
- `execution:{id}` - Execution output stream
- `job:{id}` - Job progress updates
- `playbook:{id}` - Playbook updates

### Messages
```javascript
// Subscribe
{ "type": "subscribe", "channel": "execution:123" }

// Unsubscribe
{ "type": "unsubscribe", "channel": "execution:123" }

// Authenticate
{ "type": "authenticate", "token": "your-jwt-token" }
```

## Environment Variables

```env
# Backend
NODE_ENV=production
WEB_PORT=3001
DB_HOST=postgres
DB_PORT=5432
DB_USER=awx
DB_PASSWORD=awxpass
DB_NAME=ansible_mcp
JWT_SECRET=your-secret-key
CORS_ORIGINS=http://localhost:3001

# Frontend
VITE_API_URL=/api
```

## Default Credentials

After first run, you can register a new user or use these demo credentials:

- **Username**: admin
- **Password**: admin123

## Port Assignments

- **3001**: Web UI
- **3002**: Grafana (updated from 3001)
- **3000**: MCP Server
- **5432**: PostgreSQL
- **6379**: Redis

## License

MIT
