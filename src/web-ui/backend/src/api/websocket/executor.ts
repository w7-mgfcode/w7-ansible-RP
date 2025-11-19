import { WebSocket, WebSocketServer } from 'ws';
import { Server } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { verifyToken, JwtPayload } from '../middleware/auth.js';

interface Client {
  id: string;
  ws: WebSocket;
  user?: JwtPayload;
  subscriptions: Set<string>;
}

export class WebSocketManager {
  private wss: WebSocketServer;
  private clients: Map<string, Client> = new Map();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientId = uuidv4();
      const client: Client = {
        id: clientId,
        ws,
        subscriptions: new Set()
      };

      // Try to authenticate from query string
      const url = new URL(req.url || '', `ws://${req.headers.host}`);
      const token = url.searchParams.get('token');

      if (token) {
        try {
          client.user = verifyToken(token);
        } catch {
          // Invalid token, continue as anonymous
        }
      }

      this.clients.set(clientId, client);

      // Send welcome message
      this.send(ws, {
        type: 'connected',
        clientId,
        authenticated: !!client.user
      });

      ws.on('message', (data) => {
        this.handleMessage(client, data.toString());
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
      });

      ws.on('error', (error) => {
        console.error(`WebSocket error for client ${clientId}:`, error);
        this.clients.delete(clientId);
      });
    });
  }

  private handleMessage(client: Client, message: string): void {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'subscribe':
          if (data.channel) {
            client.subscriptions.add(data.channel);
            this.send(client.ws, {
              type: 'subscribed',
              channel: data.channel
            });
          }
          break;

        case 'unsubscribe':
          if (data.channel) {
            client.subscriptions.delete(data.channel);
            this.send(client.ws, {
              type: 'unsubscribed',
              channel: data.channel
            });
          }
          break;

        case 'authenticate':
          if (data.token) {
            try {
              client.user = verifyToken(data.token);
              this.send(client.ws, {
                type: 'authenticated',
                user: client.user.username
              });
            } catch {
              this.send(client.ws, {
                type: 'error',
                message: 'Invalid token'
              });
            }
          }
          break;

        case 'ping':
          this.send(client.ws, { type: 'pong' });
          break;

        default:
          this.send(client.ws, {
            type: 'error',
            message: `Unknown message type: ${data.type}`
          });
      }
    } catch {
      this.send(client.ws, {
        type: 'error',
        message: 'Invalid message format'
      });
    }
  }

  private send(ws: WebSocket, data: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // Broadcast to all clients subscribed to a channel
  public broadcast(channel: string, data: object): void {
    const message = JSON.stringify({
      type: 'message',
      channel,
      data
    });

    this.clients.forEach(client => {
      if (client.subscriptions.has(channel) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    });
  }

  // Broadcast execution output
  public broadcastExecutionOutput(executionId: string, output: string, status: string): void {
    this.broadcast(`execution:${executionId}`, {
      executionId,
      output,
      status,
      timestamp: new Date().toISOString()
    });
  }

  // Broadcast job progress
  public broadcastJobProgress(jobId: string, progress: number, status: string): void {
    this.broadcast(`job:${jobId}`, {
      jobId,
      progress,
      status,
      timestamp: new Date().toISOString()
    });
  }

  // Broadcast playbook update
  public broadcastPlaybookUpdate(playbookId: string, event: string, data: object): void {
    this.broadcast(`playbook:${playbookId}`, {
      event,
      data,
      timestamp: new Date().toISOString()
    });
  }

  // Get connected client count
  public getClientCount(): number {
    return this.clients.size;
  }

  // Get authenticated client count
  public getAuthenticatedCount(): number {
    let count = 0;
    this.clients.forEach(client => {
      if (client.user) count++;
    });
    return count;
  }
}
