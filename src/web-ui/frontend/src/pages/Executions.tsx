import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { executionsApi } from '../lib/api';
import {
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  StopCircle,
  Eye,
  Filter,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useState } from 'react';
import { Link } from 'react-router-dom';

interface Execution {
  id: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  playbook?: {
    name: string;
  };
  inventory?: string;
  checkMode: boolean;
  startedAt: string;
  durationSeconds?: number;
}

export default function Executions() {
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['executions', statusFilter, page],
    queryFn: () => executionsApi.list({
      status: statusFilter || undefined,
      limit,
      offset: (page - 1) * limit,
    }).then(res => res.data),
  });

  const totalPages = data?.total ? Math.ceil(data.total / limit) : 1;

  const stopMutation = useMutation({
    mutationFn: (id: string) => executionsApi.stop(id),
    onSuccess: () => {
      toast.success('Execution stopped');
      queryClient.invalidateQueries({ queryKey: ['executions'] });
    },
    onError: () => {
      toast.error('Failed to stop execution');
    },
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'running':
        return <Play className="w-5 h-5 text-blue-500 animate-pulse" />;
      case 'cancelled':
        return <StopCircle className="w-5 h-5 text-gray-500" />;
      default:
        return <Clock className="w-5 h-5 text-yellow-500" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Executions</h1>
        <p className="text-gray-600">Monitor playbook executions</p>
      </div>

      {/* Filters */}
      <div className="card p-4 flex items-center space-x-4">
        <Filter className="w-4 h-4 text-gray-400" />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input w-40"
        >
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="running">Running</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {/* Executions list */}
      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full mx-auto" />
            <p className="mt-2 text-gray-500">Loading executions...</p>
          </div>
        ) : data?.executions?.length === 0 ? (
          <div className="p-8 text-center">
            <Play className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No executions yet</h3>
            <p className="text-gray-500">
              Execute a playbook to see results here
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-500 border-b bg-gray-50">
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Playbook</th>
                  <th className="px-6 py-3 font-medium">Inventory</th>
                  <th className="px-6 py-3 font-medium">Started</th>
                  <th className="px-6 py-3 font-medium">Duration</th>
                  <th className="px-6 py-3 font-medium w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.executions?.map((execution: Execution) => (
                  <tr key={execution.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        {getStatusIcon(execution.status)}
                        <span className={clsx(
                          'ml-2 text-sm font-medium',
                          execution.status === 'success' && 'text-green-700',
                          execution.status === 'failed' && 'text-red-700',
                          execution.status === 'running' && 'text-blue-700',
                          execution.status === 'cancelled' && 'text-gray-700',
                          execution.status === 'pending' && 'text-yellow-700'
                        )}>
                          {execution.status}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-900">
                        {execution.playbook?.name || 'Unknown'}
                      </span>
                      {execution.checkMode && (
                        <span className="ml-2 px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded">
                          Check Mode
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {execution.inventory || 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(execution.startedAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {execution.durationSeconds != null
                        ? `${execution.durationSeconds.toFixed(1)}s`
                        : execution.status === 'running'
                        ? 'In progress...'
                        : 'N/A'
                      }
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <Link
                          to={`/executions/${execution.id}`}
                          className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700"
                          title="View details"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        {execution.status === 'running' && (
                          <button
                            onClick={() => stopMutation.mutate(execution.id)}
                            className="p-1 hover:bg-red-100 rounded text-red-500 hover:text-red-700"
                            title="Stop execution"
                          >
                            <StopCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data?.executions && data.executions.length > 0 && (
          <div className="px-6 py-3 border-t bg-gray-50 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              Showing {((page - 1) * limit) + 1} to {Math.min(page * limit, data.total || 0)} of {data.total || 0} executions
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
