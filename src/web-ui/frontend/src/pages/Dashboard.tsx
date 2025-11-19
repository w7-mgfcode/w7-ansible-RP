import { useQuery } from '@tanstack/react-query';
import { executionsApi, playbooksApi, jobsApi, healthApi } from '../lib/api';
import {
  FileCode2,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  TrendingUp,
  Server,
} from 'lucide-react';
import clsx from 'clsx';

export default function Dashboard() {
  const { data: execStats } = useQuery({
    queryKey: ['execution-stats'],
    queryFn: () => executionsApi.stats().then(res => res.data),
  });

  const { data: jobStats } = useQuery({
    queryKey: ['job-stats'],
    queryFn: () => jobsApi.queueStats().then(res => res.data),
  });

  const { data: playbooks } = useQuery({
    queryKey: ['playbooks-recent'],
    queryFn: () => playbooksApi.list({ limit: 5 }).then(res => res.data),
  });

  const { data: executions } = useQuery({
    queryKey: ['executions-recent'],
    queryFn: () => executionsApi.list({ limit: 5 }).then(res => res.data),
  });

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => healthApi.check().then(res => res.data),
    refetchInterval: 30000,
  });

  const stats = [
    {
      name: 'Total Playbooks',
      value: playbooks?.pagination?.total || 0,
      icon: FileCode2,
      color: 'bg-blue-500',
    },
    {
      name: 'Total Executions',
      value: execStats?.total || 0,
      icon: Play,
      color: 'bg-purple-500',
    },
    {
      name: 'Success Rate',
      value: `${execStats?.successRate || 0}%`,
      icon: TrendingUp,
      color: 'bg-green-500',
    },
    {
      name: 'Running Jobs',
      value: jobStats?.processing || 0,
      icon: Activity,
      color: 'bg-orange-500',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600">Overview of your Ansible MCP Server</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <div key={stat.name} className="card p-6">
            <div className="flex items-center">
              <div className={clsx('p-3 rounded-lg', stat.color)}>
                <stat.icon className="w-6 h-6 text-white" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">{stat.name}</p>
                <p className="text-2xl font-semibold text-gray-900">{stat.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Status and activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* System Status */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Server className="w-5 h-5 mr-2 text-gray-500" />
            System Status
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">API Server</span>
              <span className={clsx(
                'status-badge',
                health?.status === 'healthy' ? 'status-success' : 'status-error'
              )}>
                {health?.status || 'Unknown'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Uptime</span>
              <span className="text-sm text-gray-900">
                {health?.uptime ? `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m` : 'N/A'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Queue</span>
              <span className="text-sm text-gray-900">
                {jobStats?.queued || 0} pending
              </span>
            </div>
          </div>
        </div>

        {/* Recent Executions */}
        <div className="card p-6 lg:col-span-2">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Activity className="w-5 h-5 mr-2 text-gray-500" />
            Recent Executions
          </h3>
          <div className="space-y-3">
            {executions?.executions?.length === 0 ? (
              <p className="text-sm text-gray-500">No executions yet</p>
            ) : (
              executions?.executions?.map((exec: any) => (
                <div key={exec.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div className="flex items-center">
                    {exec.status === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500 mr-2" />
                    ) : exec.status === 'failed' ? (
                      <XCircle className="w-4 h-4 text-red-500 mr-2" />
                    ) : (
                      <Clock className="w-4 h-4 text-yellow-500 mr-2" />
                    )}
                    <span className="text-sm text-gray-900">
                      {exec.playbook?.name || 'Unknown Playbook'}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">
                    {new Date(exec.startedAt).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Recent Playbooks */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <FileCode2 className="w-5 h-5 mr-2 text-gray-500" />
          Recent Playbooks
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-gray-500 border-b">
                <th className="pb-3 font-medium">Name</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium">Version</th>
                <th className="pb-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {playbooks?.playbooks?.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-4 text-sm text-gray-500">
                    No playbooks yet
                  </td>
                </tr>
              ) : (
                playbooks?.playbooks?.map((playbook: any) => (
                  <tr key={playbook.id} className="border-b last:border-0">
                    <td className="py-3 text-sm text-gray-900">{playbook.name}</td>
                    <td className="py-3">
                      <span className={clsx(
                        'status-badge',
                        playbook.status === 'validated' ? 'status-success' :
                        playbook.status === 'failed' ? 'status-error' : 'status-pending'
                      )}>
                        {playbook.status}
                      </span>
                    </td>
                    <td className="py-3 text-sm text-gray-600">v{playbook.version}</td>
                    <td className="py-3 text-sm text-gray-500">
                      {new Date(playbook.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
