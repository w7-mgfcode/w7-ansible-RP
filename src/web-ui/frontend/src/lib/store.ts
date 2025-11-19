import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user' | 'viewer';
}

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  setAuth: (token: string, user: User) => void;
  clearAuth: () => void;
}

// SECURITY NOTE: JWT tokens stored in localStorage are vulnerable to XSS attacks.
// For production deployments with sensitive data, consider migrating to HttpOnly
// cookies with Secure and SameSite=Strict attributes. This would require:
// 1. Backend: Set JWT in HttpOnly cookie instead of response body
// 2. Backend: Read token from cookie instead of Authorization header
// 3. Frontend: Remove token from localStorage, rely on automatic cookie sending
// 4. Configure CORS with credentials: true and specific origins
//
// Current implementation is suitable for internal tools but should be hardened
// for public-facing applications. See OWASP guidelines for token storage.
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      setAuth: (token, user) => {
        // persist middleware handles localStorage automatically
        set({ token, user, isAuthenticated: true });
      },
      clearAuth: () => {
        set({ token: null, user: null, isAuthenticated: false });
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ token: state.token, user: state.user }),
      // Derive isAuthenticated from token presence on rehydration
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isAuthenticated = Boolean(state.token);
        }
      },
    }
  )
);

// Theme store
interface ThemeState {
  isDark: boolean;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      isDark: false,
      toggleTheme: () => set((state) => ({ isDark: !state.isDark })),
    }),
    {
      name: 'theme-storage',
    }
  )
);

// Sidebar store
interface SidebarState {
  isCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isCollapsed: false,
  toggleSidebar: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
}));
