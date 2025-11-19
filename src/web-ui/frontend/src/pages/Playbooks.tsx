import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { playbooksApi, templatesApi } from '../lib/api';
import {
  Plus,
  Search,
  Filter,
  MoreVertical,
  Play,
  CheckCircle,
  FileCode2,
  Trash2,
  Edit,
  Wand2,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';

interface CreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function CreatePlaybookModal({ isOpen, onClose, onSuccess }: CreateModalProps) {
  const [mode, setMode] = useState<'manual' | 'generate'>('generate');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    content: '',
    prompt: '',
    template: '',
  });

  const { data: templates } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesApi.list().then(res => res.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => playbooksApi.create(data),
    onSuccess: () => {
      toast.success('Playbook created successfully');
      onSuccess();
      onClose();
      setFormData({ name: '', description: '', content: '', prompt: '', template: '' });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to create playbook');
    },
  });

  const generateMutation = useMutation({
    mutationFn: (data: any) => playbooksApi.generate(data),
    onSuccess: () => {
      toast.success('Generation started');
      // In a real implementation, this would create a job and redirect
      onClose();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to generate playbook');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'generate') {
      generateMutation.mutate({
        prompt: formData.prompt,
        template: formData.template || undefined,
      });
    } else {
      createMutation.mutate({
        name: formData.name,
        description: formData.description,
        content: formData.content,
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Create Playbook</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Mode selector */}
          <div className="flex space-x-4">
            <button
              type="button"
              onClick={() => setMode('generate')}
              className={clsx(
                'flex-1 p-4 rounded-lg border-2 text-left transition-colors',
                mode === 'generate'
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300'
              )}
            >
              <Wand2 className="w-5 h-5 text-primary-500 mb-2" />
              <p className="font-medium text-gray-900">Generate with AI</p>
              <p className="text-sm text-gray-500">Create playbook from prompt</p>
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={clsx(
                'flex-1 p-4 rounded-lg border-2 text-left transition-colors',
                mode === 'manual'
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300'
              )}
            >
              <FileCode2 className="w-5 h-5 text-primary-500 mb-2" />
              <p className="font-medium text-gray-900">Manual Entry</p>
              <p className="text-sm text-gray-500">Write YAML directly</p>
            </button>
          </div>

          {mode === 'generate' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Template (Optional)
                </label>
                <select
                  value={formData.template}
                  onChange={(e) => setFormData({ ...formData, template: e.target.value })}
                  className="input"
                >
                  <option value="">No template - generate from scratch</option>
                  {templates?.templates?.map((t: any) => (
                    <option key={t.id} value={t.id}>
                      {t.name} - {t.description}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Prompt *
                </label>
                <textarea
                  value={formData.prompt}
                  onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                  placeholder="Describe what you want the playbook to do..."
                  rows={6}
                  className="input font-mono text-sm"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">
                  Example: "Deploy a scalable nginx web server to production with SSL and monitoring"
                </p>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My Playbook"
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="What this playbook does..."
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Content (YAML) *
                </label>
                <textarea
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="---\n- name: My Playbook\n  hosts: all\n  tasks:\n    - name: Example task\n      debug:\n        msg: Hello World"
                  rows={12}
                  className="input font-mono text-sm"
                  required
                />
              </div>
            </>
          )}

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || generateMutation.isPending}
              className="btn-primary"
            >
              {(createMutation.isPending || generateMutation.isPending)
                ? 'Creating...'
                : mode === 'generate'
                ? 'Generate'
                : 'Create'
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Playbooks() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['playbooks', searchTerm, statusFilter],
    queryFn: () => playbooksApi.list({
      search: searchTerm || undefined,
      status: statusFilter || undefined,
    }).then(res => res.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => playbooksApi.delete(id),
    onSuccess: () => {
      toast.success('Playbook deleted');
      queryClient.invalidateQueries({ queryKey: ['playbooks'] });
    },
    onError: () => {
      toast.error('Failed to delete playbook');
    },
  });

  const validateMutation = useMutation({
    mutationFn: (id: string) => playbooksApi.validate(id),
    onSuccess: () => {
      toast.success('Validation started');
      queryClient.invalidateQueries({ queryKey: ['playbooks'] });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Playbooks</h1>
          <p className="text-gray-600">Manage your Ansible playbooks</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Playbook
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search playbooks..."
            className="input pl-10"
          />
        </div>
        <div className="flex items-center space-x-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input w-40"
          >
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="validated">Validated</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {/* Playbooks list */}
      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full mx-auto" />
            <p className="mt-2 text-gray-500">Loading playbooks...</p>
          </div>
        ) : data?.playbooks?.length === 0 ? (
          <div className="p-8 text-center">
            <FileCode2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No playbooks yet</h3>
            <p className="text-gray-500 mb-4">
              Get started by creating your first playbook
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Playbook
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-500 border-b bg-gray-50">
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Version</th>
                  <th className="px-6 py-3 font-medium">Created</th>
                  <th className="px-6 py-3 font-medium">Tags</th>
                  <th className="px-6 py-3 font-medium w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.playbooks?.map((playbook: any) => (
                  <tr key={playbook.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <Link
                        to={`/playbooks/${playbook.id}`}
                        className="text-sm font-medium text-gray-900 hover:text-primary-600"
                      >
                        {playbook.name}
                      </Link>
                      {playbook.description && (
                        <p className="text-xs text-gray-500 mt-1 truncate max-w-xs">
                          {playbook.description}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={clsx(
                        'status-badge',
                        playbook.status === 'validated' ? 'status-success' :
                        playbook.status === 'failed' ? 'status-error' : 'status-pending'
                      )}>
                        {playbook.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      v{playbook.version}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(playbook.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {playbook.tags?.slice(0, 2).map((tag: string) => (
                          <span
                            key={tag}
                            className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded"
                          >
                            {tag}
                          </span>
                        ))}
                        {playbook.tags?.length > 2 && (
                          <span className="text-xs text-gray-500">
                            +{playbook.tags.length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="relative">
                        <button
                          onClick={() => setActiveMenu(activeMenu === playbook.id ? null : playbook.id)}
                          className="p-1 hover:bg-gray-100 rounded"
                        >
                          <MoreVertical className="w-4 h-4 text-gray-500" />
                        </button>
                        {activeMenu === playbook.id && (
                          <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
                            <Link
                              to={`/playbooks/${playbook.id}`}
                              className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                            >
                              <Edit className="w-4 h-4 mr-2" />
                              Edit
                            </Link>
                            <button
                              onClick={() => {
                                validateMutation.mutate(playbook.id);
                                setActiveMenu(null);
                              }}
                              className="w-full flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                            >
                              <CheckCircle className="w-4 h-4 mr-2" />
                              Validate
                            </button>
                            <Link
                              to={`/playbooks/${playbook.id}/execute`}
                              className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                            >
                              <Play className="w-4 h-4 mr-2" />
                              Execute
                            </Link>
                            <hr className="my-1" />
                            <button
                              onClick={() => {
                                if (confirm('Are you sure you want to delete this playbook?')) {
                                  deleteMutation.mutate(playbook.id);
                                }
                                setActiveMenu(null);
                              }}
                              className="w-full flex items-center px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {data?.pagination && data.pagination.pages > 1 && (
        <div className="flex items-center justify-between px-4">
          <p className="text-sm text-gray-500">
            Showing {data.playbooks.length} of {data.pagination.total} playbooks
          </p>
          <div className="flex space-x-2">
            {/* Add pagination controls here */}
          </div>
        </div>
      )}

      {/* Create Modal */}
      <CreatePlaybookModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['playbooks'] })}
      />
    </div>
  );
}
