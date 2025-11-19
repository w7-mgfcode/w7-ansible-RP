import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  FileCode2,
  Play,
  Files,
  Settings,
  ChevronLeft,
  ChevronRight,
  Terminal,
  Activity,
} from 'lucide-react';
import { useSidebarStore, useAuthStore } from '../lib/store';
import clsx from 'clsx';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Playbooks', href: '/playbooks', icon: FileCode2 },
  { name: 'Executions', href: '/executions', icon: Play },
  { name: 'Templates', href: '/templates', icon: Files },
  { name: 'Jobs', href: '/jobs', icon: Activity },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export default function Sidebar() {
  const { isCollapsed, toggleSidebar } = useSidebarStore();
  const { isAuthenticated } = useAuthStore();
  const location = useLocation();

  return (
    <aside
      className={clsx(
        'fixed left-0 top-0 h-full bg-gray-900 text-white transition-all duration-300 z-50',
        isCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-gray-800">
        <Terminal className="w-8 h-8 text-red-500 flex-shrink-0" />
        {!isCollapsed && (
          <span className="ml-3 text-lg font-semibold truncate">
            Ansible MCP
          </span>
        )}
      </div>

      {/* Toggle button */}
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-20 bg-gray-900 border border-gray-700 rounded-full p-1 hover:bg-gray-800"
      >
        {isCollapsed ? (
          <ChevronRight className="w-4 h-4" />
        ) : (
          <ChevronLeft className="w-4 h-4" />
        )}
      </button>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href ||
            (item.href !== '/' && location.pathname.startsWith(item.href));

          // Hide settings for non-authenticated users
          if (item.name === 'Settings' && !isAuthenticated) {
            return null;
          }

          return (
            <Link
              key={item.name}
              to={item.href}
              className={clsx(
                'flex items-center px-3 py-2 rounded-lg transition-colors',
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              )}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {!isCollapsed && (
                <span className="ml-3 truncate">{item.name}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Version */}
      {!isCollapsed && (
        <div className="px-4 py-4 border-t border-gray-800">
          <p className="text-xs text-gray-500">Version 2.0.0</p>
        </div>
      )}
    </aside>
  );
}
