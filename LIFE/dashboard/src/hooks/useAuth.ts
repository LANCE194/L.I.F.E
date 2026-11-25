/**
 * L.I.F.E. Authentication Hook
 * Holds the signed-in user and exposes login/logout/password change.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  api,
  PASSWORD_CHANGE_EVENT,
  type User,
  type LoginRequest,
  type ChangePasswordRequest,
} from '../api/client';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  /** Trainee accounts see only their own progress and the CPR guide. */
  isTrainee: boolean;
  isLoading: boolean;
  mustChangePassword: boolean;
  login: (credentials: LoginRequest) => Promise<User>;
  logout: () => Promise<void>;
  changePassword: (data: ChangePasswordRequest) => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    if (!api.isAuthenticated()) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const response = await api.getMe();
      setUser(response.user);
    } catch {
      api.clearToken();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  // If any request reports that a password change is required, reflect it in the UI.
  useEffect(() => {
    const onPasswordChangeRequired = () => {
      setUser(previous => (previous ? { ...previous, must_change_password: true } : previous));
    };
    window.addEventListener(PASSWORD_CHANGE_EVENT, onPasswordChangeRequired);
    return () => window.removeEventListener(PASSWORD_CHANGE_EVENT, onPasswordChangeRequired);
  }, []);

  const login = useCallback(async (credentials: LoginRequest) => {
    const response = await api.login(credentials);
    setUser(response.user);
    return response.user;
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const changePassword = useCallback(async (data: ChangePasswordRequest) => {
    const response = await api.changePassword(data);
    setUser(response.user);
  }, []);

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    isTrainee: user?.role === 'trainee',
    isLoading,
    mustChangePassword: Boolean(user?.must_change_password),
    login,
    logout,
    changePassword,
    checkAuth,
  };

  return React.createElement(AuthContext.Provider, { value }, children);
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
