import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoriesApi } from '../lib/api';
import {
  Server,
  Plus,
  Pencil,
  Trash2,
  Search,
  Filter,
  TestTube,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useState } from 'react';

interface Inventory {
  id: string;
  name: string;
  description?: string;
  content: string;
  type: 'static' | 'dynamic';
  hostCount: number;
  groupCount: number;
  groups: string[];
  lastTestedAt?: string;
  lastTestSuccess?: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function Inventories() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editingInventory, setEditingInventory] = useState<Inventory | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    content: '',
    type: 'static' as 'static' | 'dynamic',
  });
  const limit = 20;
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['inventories', typeFilter, search, page],
    queryFn: () => inventoriesApi.list({
      type: typeFilter || undefined,
      search: search || undefined,
      page,
      limit,
    }).then(res => res.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => inventoriesApi.create(data),
    onSuccess: () => {
      toast.success('Inventory created');
      queryClient.invalidateQueries({ queryKey: ['inventories'] });
      closeModal();
    },
    onError: () => {
      toast.error('Failed to create inventory');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof formData }) =>
      inventoriesApi.update(id, data),
    onSuccess: () => {
      toast.success('Inventory updated');
      queryClient.invalidateQueries({ queryKey: ['inventories'] });
      closeModal();
    },
    onError: () => {
      toast.error('Failed to update inventory');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => inventoriesApi.delete(id),
    onSuccess: () => {
      toast.success('Inventory deleted');
      queryClient.invalidateQueries({ queryKey: ['inventories'] });
    },
    onError: () => {
      toast.error('Failed to delete inventory');
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => inventoriesApi.test(id),
    onSuccess: () => {
      toast.success('Inventory test completed');
      queryClient.invalidateQueries({ queryKey: ['inventories'] });
    },
    onError: () => {
      toast.error('Failed to test inventory');
    },
  });

  const openModal = (inventory?: Inventory) => {
    if (inventory) {
      setEditingInventory(inventory);
      setFormData({
        name: inventory.name,
        description: inventory.description || '',
        content: inventory.content,
        type: inventory.type,
      });
    } else {
      setEditingInventory(null);
      setFormData({
        name: '',
        description: '',
        content: `[webservers]
web1.example.com
web2.example.com

[databases]
db1.example.com ansible_user=admin`,
        type: 'static',
      });
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingInventory(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingInventory) {
      updateMutation.mutate({ id: editingInventory.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete "${name}"?`)) {
      deleteMutation.mutate(id);
    }
  };

  const totalPages = data?.pagination?.pages || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventories</h1>
          <p className="text-gray-600">Manage Ansible inventory files</p>
        </div>
        <button
          onClick={() => openModal()}
          className="btn btn-primary flex items-center"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Inventory
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 flex items-center space-x-4">
        <div className="flex items-center flex-1">
          <Search className="w-4 h-4 text-gray-400 mr-2" />
          <input
            type="text"
            placeholder="Search inventories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input flex-1"
          />
        </div>
        <Filter className="w-4 h-4 text-gray-400" />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="input w-40"
        >
          <option value="">All Types</option>
          <option value="static">Static</option>
          <option value="dynamic">Dynamic</option>
        </select>
      </div>

      {/* Inventories list */}
      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full mx-auto" />
            <p className="mt-2 text-gray-500">Loading inventories...</p>
          </div>
        ) : data?.inventories?.length === 0 ? (
          <div className="p-8 text-center">
            <Server className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No inventories yet</h3>
            <p className="text-gray-500 mb-4">
              Create an inventory to manage your hosts
            </p>
            <button
              onClick={() => openModal()}
              className="btn btn-primary"
            >
              Create Inventory
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-500 border-b bg-gray-50">
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">Hosts</th>
                  <th className="px-6 py-3 font-medium">Groups</th>
                  <th className="px-6 py-3 font-medium">Last Tested</th>
                  <th className="px-6 py-3 font-medium w-32">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.inventories?.map((inventory: Inventory) => (
                  <tr key={inventory.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {inventory.name}
                        </div>
                        {inventory.description && (
                          <div className="text-sm text-gray-500">
                            {inventory.description}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={clsx(
                        'px-2 py-1 text-xs rounded-full font-medium',
                        inventory.type === 'static'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-purple-100 text-purple-700'
                      )}>
                        {inventory.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {inventory.hostCount}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {inventory.groupCount}
                    </td>
                    <td className="px-6 py-4">
                      {inventory.lastTestedAt ? (
                        <div className="flex items-center">
                          {inventory.lastTestSuccess ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500 mr-1" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-500 mr-1" />
                          )}
                          <span className="text-sm text-gray-500">
                            {new Date(inventory.lastTestedAt).toLocaleDateString()}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-400">Never</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => openModal(inventory)}
                          className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => testMutation.mutate(inventory.id)}
                          className="p-1 hover:bg-blue-100 rounded text-blue-500 hover:text-blue-700"
                          title="Test connectivity"
                        >
                          <TestTube className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(inventory.id, inventory.name)}
                          className="p-1 hover:bg-red-100 rounded text-red-500 hover:text-red-700"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data?.inventories && data.inventories.length > 0 && (
          <div className="px-6 py-3 border-t bg-gray-50 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              Showing {((page - 1) * limit) + 1} to {Math.min(page * limit, data.pagination?.total || 0)} of {data.pagination?.total || 0} inventories
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

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h2 className="text-xl font-semibold">
                {editingInventory ? 'Edit Inventory' : 'Create Inventory'}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input w-full"
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
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type
                </label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as 'static' | 'dynamic' })}
                  className="input w-full"
                >
                  <option value="static">Static</option>
                  <option value="dynamic">Dynamic</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Content (INI format)
                </label>
                <textarea
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  className="input w-full font-mono text-sm"
                  rows={12}
                  required
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
