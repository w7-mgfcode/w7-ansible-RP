import { useEffect, useState } from 'react';
import { useWebSocketContext } from '../contexts/WebSocketContext';

// Re-export the context hook for convenience
export { useWebSocketContext as useWebSocket };

export function useExecutionStream(executionId: string) {
  const { subscribe, unsubscribe, lastMessage } = useWebSocketContext();
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (executionId) {
      // Reset state when switching to a new execution
      setOutput('');
      setStatus('');
      subscribe(`execution:${executionId}`);
      return () => unsubscribe(`execution:${executionId}`);
    }
  }, [executionId, subscribe, unsubscribe]);

  useEffect(() => {
    if (lastMessage?.channel === `execution:${executionId}`) {
      if (lastMessage.data?.output) {
        setOutput(prev => prev + lastMessage.data.output);
      }
      if (lastMessage.data?.status) {
        setStatus(lastMessage.data.status);
      }
    }
  }, [lastMessage, executionId]);

  return { output, status };
}
