import { useQuery } from '@tanstack/react-query';
import { templatesApi } from '../lib/api';
import { Files, Search, Tag } from 'lucide-react';
import { useState } from 'react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import yaml from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml';
import { githubGist } from 'react-syntax-highlighter/dist/esm/styles/hljs';

SyntaxHighlighter.registerLanguage('yaml', yaml);

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
}

export default function Templates() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  const { data: templates, isLoading, error } = useQuery({
    queryKey: ['templates', searchTerm, selectedCategory],
    queryFn: () => templatesApi.list({
      search: searchTerm || undefined,
      category: selectedCategory || undefined,
    }).then(res => res.data),
  });

  const { data: categories } = useQuery({
    queryKey: ['template-categories'],
    queryFn: () => templatesApi.categories().then(res => res.data),
  });

  const { data: templateDetail } = useQuery({
    queryKey: ['template', selectedTemplate?.id],
    queryFn: () => templatesApi.get(selectedTemplate!.id).then(res => res.data),
    enabled: !!selectedTemplate?.id,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Templates</h1>
        <p className="text-gray-600">Pre-built playbook templates for common tasks</p>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search templates..."
            className="input pl-10"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="input w-40"
        >
          <option value="">All Categories</option>
          {categories?.categories?.map((cat: string) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Templates list */}
        <div className="lg:col-span-1 space-y-4">
          {isLoading ? (
            <div className="card p-8 text-center">
              <div className="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full mx-auto" />
            </div>
          ) : error ? (
            <div className="card p-8 text-center">
              <Files className="w-12 h-12 text-red-300 mx-auto mb-4" />
              <p className="text-red-500">Failed to load templates</p>
              <p className="text-sm text-gray-500 mt-1">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
            </div>
          ) : templates?.templates?.length === 0 ? (
            <div className="card p-8 text-center">
              <Files className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No templates found</p>
            </div>
          ) : (
            templates?.templates?.map((template: Template) => (
              <button
                key={template.id}
                onClick={() => setSelectedTemplate(template)}
                className={`card p-4 w-full text-left transition-colors ${
                  selectedTemplate?.id === template.id
                    ? 'ring-2 ring-primary-500 bg-primary-50'
                    : 'hover:bg-gray-50'
                }`}
              >
                <h3 className="font-medium text-gray-900">{template.name}</h3>
                <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                  {template.description}
                </p>
                <div className="flex items-center mt-2">
                  <Tag className="w-3 h-3 text-gray-400 mr-1" />
                  <span className="text-xs text-gray-500">{template.category}</span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Template preview */}
        <div className="lg:col-span-2">
          {selectedTemplate && templateDetail ? (
            <div className="card">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">
                  {templateDetail.name}
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  {templateDetail.description}
                </p>
                {templateDetail.variables?.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-gray-500 mb-1">Variables:</p>
                    <div className="flex flex-wrap gap-1">
                      {templateDetail.variables.map((v: string) => (
                        <span
                          key={v}
                          className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded"
                        >
                          {v}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="max-h-[500px] overflow-auto">
                <SyntaxHighlighter
                  language="yaml"
                  style={githubGist}
                  customStyle={{
                    margin: 0,
                    padding: '1rem',
                    fontSize: '0.875rem',
                    background: '#f8f9fa',
                  }}
                >
                  {templateDetail.content}
                </SyntaxHighlighter>
              </div>
            </div>
          ) : (
            <div className="card p-8 text-center">
              <Files className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Select a template
              </h3>
              <p className="text-gray-500">
                Choose a template from the list to preview its content
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
