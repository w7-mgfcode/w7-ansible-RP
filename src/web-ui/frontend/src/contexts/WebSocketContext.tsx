import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '../lib/store';

interface WebSocketMessage {
  type: string;
  channel?: string;
  data?: any;
  [key: string]: any;
}

interface WebSocketContextValue {
  isConnected: boolean;
  lastMessage: WebSocketMessage | null;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  send: (data: object) => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null);
  const shouldReconnect = useRef(true);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const subscribedChannels = useRef<Set<string>>(new Set());
  const { token } = useAuthStore();

  const connect = useCallback(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws${token ? `?token=${token}` : ''}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (shouldReconnect.current) {
        setIsConnected(true);
        // Re-subscribe to channels
        subscribedChannels.current.forEach(channel => {
          ws.send(JSON.stringify({ type: 'subscribe', channel }));
        });
      }
    };

    ws.onmessage = (event) => {
      if (!shouldReconnect.current) return;
      try {
        const message = JSON.parse(event.data);
        setLastMessage(message);
      } catch {
        console.error('Failed to parse WebSocket message');
      }
    };

    ws.onclose = () => {
      // Only update state and reconnect if component is still mounted
      if (shouldReconnect.current) {
        setIsConnected(false);
        // Reconnect after 3 seconds
        setTimeout(() => {
          if (shouldReconnect.current && wsRef.current?.readyState === WebSocket.CLOSED) {
            connect();
          }
        }, 3000);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }, [token]);

  useEffect(() => {
    shouldReconnect.current = true;
    connect();

    return () => {
      shouldReconnect.current = false;
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const subscribe = useCallback((channel: string) => {
    subscribedChannels.current.add(channel);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', channel }));
    }
  }, []);

  const unsubscribe = useCallback((channel: string) => {
    subscribedChannels.current.delete(channel);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', channel }));
    }
  }, []);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const value: WebSocketContextValue = {
    isConnected,
    lastMessage,
    subscribe,
    unsubscribe,
    send,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocketContext(): WebSocketContextValue {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext must be used within a WebSocketProvider');
  }
  return context;
}
