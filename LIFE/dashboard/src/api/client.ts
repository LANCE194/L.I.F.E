/**
 * L.I.F.E. API Client
 * Centralized API communication with authentication
 */

import type {
  AuthResponse,
  ChangePasswordResponse,
  SessionCreateResponse,
  LoginRequest,
  ChangePasswordRequest,
  User,
  Trainee,
  TraineeCreateRequest,
  TraineeUpdateRequest,
  TraineeListResponse,
  Session,
  ProcedureSteps,
  SessionCreateRequest,
  SessionListResponse,
  SessionWithDetails,
  SessionDetailCreateRequest,
  LiveStatus,
  LiveStatusUpdateRequest,
  LeaderboardResponse,
  LeaderboardEntry,
  OrganizationStats,
  DashboardResponse,
  TraineeStatsResponse,
  Settings,
  SettingsUpdateRequest,
  HealthResponse,
  TopTrainee,
  AccuracyTrendPoint,
  TraineeCredentials,
  MyProgressResponse,
  SessionScope,
  ServerBackup
} from './types';

export type {
  ChangePasswordResponse,
  SessionCreateResponse,
  AuthResponse,
  LoginRequest,
  ChangePasswordRequest,
  User,
  Trainee,
  TraineeCreateRequest,
  TraineeUpdateRequest,
  TraineeListResponse,
  Session,
  ProcedureSteps,
  SessionCreateRequest,
  SessionListResponse,
  SessionWithDetails,
  SessionDetailCreateRequest,
  LiveStatus,
  LiveStatusUpdateRequest,
  LeaderboardResponse,
  LeaderboardEntry,
  OrganizationStats,
  DashboardResponse,
  TraineeStatsResponse,
  Settings,
  SettingsUpdateRequest,
  HealthResponse,
  TopTrainee,
  AccuracyTrendPoint,
  TraineeCredentials,
  MyProgressResponse,
  SessionScope,
  ServerBackup
};

const API_BASE = '/api';

export type ExportFormat = 'pdf' | 'csv';

/** format=pdf adds the viewer's time-zone offset so dates in the PDF match local time. */
function exportQuery(format: ExportFormat): URLSearchParams {
  const query = new URLSearchParams();
  if (format === 'pdf') {
    query.set('format', 'pdf');
    query.set('tz_offset_min', String(new Date().getTimezoneOffset()));
  }
  return query;
}

/** Error carrying the HTTP status and optional server error code. status 0 = network failure. */
export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

interface RequestOptions extends RequestInit {
  /** When false, a 401 does not clear the token or redirect (used for background saves). */
  redirectOn401?: boolean;
}

/** Fired on window when the server says the user must change their password. */
export const PASSWORD_CHANGE_EVENT = 'life:password-change-required';

class ApiClient {
  private token: string | null = null;
  private tokenExpiry: number | null = null;

  constructor() {
    // Load token from localStorage on init
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('life_token');
      const expiry = localStorage.getItem('life_token_expiry');
      if (expiry) {
        this.tokenExpiry = parseInt(expiry, 10);
      }
    }
  }

  setToken(token: string, expiresInMs: number = 8 * 60 * 60 * 1000) {
    this.token = token;
    this.tokenExpiry = Date.now() + expiresInMs;
    if (typeof window !== 'undefined') {
      localStorage.setItem('life_token', token);
      localStorage.setItem('life_token_expiry', this.tokenExpiry.toString());
    }
  }

  clearToken() {
    this.token = null;
    this.tokenExpiry = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('life_token');
      localStorage.removeItem('life_token_expiry');
    }
  }

  isAuthenticated(): boolean {
    return !!this.token && (!this.tokenExpiry || Date.now() < this.tokenExpiry);
  }

  private authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  private async send(endpoint: string, options: RequestOptions = {}): Promise<Response> {
    const { redirectOn401 = true, ...init } = options;
    const headers: Record<string, string> = {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...this.authHeaders(),
      ...(init.headers as Record<string, string> | undefined),
    };

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${endpoint}`, { ...init, headers });
    } catch {
      throw new ApiError('Cannot reach the L.I.F.E. server. Is it running?', 0);
    }

    if (response.status === 401 && !endpoint.startsWith('/auth/login')) {
      if (redirectOn401) {
        this.clearToken();
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
      }
      throw new ApiError('Your sign-in has expired. Please sign in again.', 401);
    }

    if (!response.ok) {
      const data: { error?: string; code?: string } = await response.json().catch(() => ({}));
      if (data.code === 'PASSWORD_CHANGE_REQUIRED' && typeof window !== 'undefined') {
        window.dispatchEvent(new Event(PASSWORD_CHANGE_EVENT));
      }
      throw new ApiError(data.error || `Request failed (HTTP ${response.status})`, response.status, data.code);
    }

    return response;
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(endpoint, options);
    return (await response.json().catch(() => ({}))) as T;
  }

  private async download(endpoint: string): Promise<Blob> {
    const response = await this.send(endpoint);
    return response.blob();
  }

  // Auth
  async login(credentials: LoginRequest): Promise<AuthResponse> {
    const data = await this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    this.setToken(data.token);
    return data;
  }

  async logout(): Promise<void> {
    try {
      await this.request('/auth/logout', { method: 'POST', redirectOn401: false });
    } catch {
      // Logging out locally is enough if the server is unreachable or the token already expired.
    } finally {
      this.clearToken();
    }
  }

  async getMe(): Promise<{ user: User }> {
    return this.request('/auth/me');
  }

  async changePassword(data: ChangePasswordRequest): Promise<ChangePasswordResponse> {
    const result = await this.request<ChangePasswordResponse>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    // Older tokens are revoked by the server; switch to the new one.
    this.setToken(result.token);
    return result;
  }

  // Trainees
  async getTrainees(params?: {
    search?: string;
    organization?: string;
    is_active?: boolean;
  }): Promise<TraineeListResponse> {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.organization) query.set('organization', params.organization);
    if (params?.is_active !== undefined) query.set('is_active', String(params.is_active));

    return this.request(`/trainees?${query.toString()}`);
  }

  async getTrainee(id: number): Promise<{ trainee: Trainee }> {
    return this.request(`/trainees/${id}`);
  }

  async createTrainee(data: TraineeCreateRequest): Promise<{ trainee: Trainee; account: TraineeCredentials | null }> {
    return this.request('/trainees', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTrainee(id: number, data: TraineeUpdateRequest): Promise<{ trainee: Trainee }> {
    return this.request(`/trainees/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /** Admin: create the sign-in account for an existing trainee (temporary password returned once). */
  async createTraineeAccount(id: number, username?: string): Promise<{ trainee: Trainee; account: TraineeCredentials }> {
    return this.request(`/trainees/${id}/account`, {
      method: 'POST',
      body: JSON.stringify(username ? { username } : {}),
    });
  }

  /** Admin: issue a new temporary password (signs the trainee out everywhere). */
  async resetTraineePassword(id: number): Promise<{ account: TraineeCredentials }> {
    return this.request(`/trainees/${id}/account/reset`, { method: 'POST' });
  }

  /** Trainee accounts: own profile, statistics, ranking and sessions. */
  async getMyProgress(): Promise<MyProgressResponse> {
    return this.request('/me/progress');
  }

  /** Trainee accounts: own data as a JSON backup (with every compression), CSV or PDF report. */
  async exportMyData(format: 'json' | 'csv' | 'pdf'): Promise<Blob> {
    const query = format === 'pdf' ? exportQuery('pdf') : new URLSearchParams();
    query.set('format', format);
    return this.download(`/me/export?${query.toString()}`);
  }

  /** Trainee accounts: certificate (PDF) for one of their own sessions. */
  async getMyCertificatePdf(sessionId: number): Promise<Blob> {
    return this.download(`/me/certificate/${sessionId}?${exportQuery('pdf').toString()}`);
  }

  async deleteTrainee(id: number): Promise<{ message: string }> {
    return this.request(`/trainees/${id}`, { method: 'DELETE' });
  }

  async getTraineeSessions(id: number): Promise<SessionListResponse> {
    return this.request(`/trainees/${id}/sessions`);
  }

  async getOrganizations(): Promise<{ organizations: string[] }> {
    return this.request('/trainees/organizations/list');
  }

  // Sessions
  /** Background-safe: a 401 never redirects, so the caller can keep the session queued. */
  async createSession(data: SessionCreateRequest): Promise<SessionCreateResponse> {
    return this.request('/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
      redirectOn401: false,
    });
  }

  async getSessions(params?: {
    trainee_id?: number;
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
  }): Promise<SessionListResponse> {
    const query = new URLSearchParams();
    if (params?.trainee_id) query.set('trainee_id', String(params.trainee_id));
    if (params?.start_date) query.set('start_date', params.start_date);
    if (params?.end_date) query.set('end_date', params.end_date);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));

    return this.request(`/sessions?${query.toString()}`);
  }

  async getSession(id: number): Promise<{ session: SessionWithDetails; details: SessionDetailCreateRequest[] }> {
    return this.request(`/sessions/${id}`);
  }

  async deleteSession(id: number): Promise<{ message: string }> {
    return this.request(`/sessions/${id}`, { method: 'DELETE' });
  }

  // Live Status
  async updateLiveStatus(data: LiveStatusUpdateRequest): Promise<{ success: boolean }> {
    return this.request('/live', {
      method: 'POST',
      body: JSON.stringify(data),
      redirectOn401: false,
    });
  }

  async getLiveStatus(): Promise<{ live: LiveStatus }> {
    return this.request('/live');
  }

  async resetLiveStatus(): Promise<{ success: boolean }> {
    return this.request('/live/reset', { method: 'POST', redirectOn401: false });
  }

  // Leaderboard
  async getLeaderboard(params?: {
    limit?: number;
    start_date?: string;
    end_date?: string;
    organization?: string;
    hide_names?: boolean;
    scope?: SessionScope;
  }): Promise<LeaderboardResponse> {
    const query = new URLSearchParams();
    if (params?.scope) query.set('scope', params.scope);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.start_date) query.set('start_date', params.start_date);
    if (params?.end_date) query.set('end_date', params.end_date);
    if (params?.organization) query.set('organization', params.organization);
    if (params?.hide_names) query.set('hide_names', 'true');

    return this.request(`/leaderboard?${query.toString()}`);
  }

  async getLeaderboardOrganizations(scope: SessionScope = 'all'): Promise<{ organizations: OrganizationStats[] }> {
    return this.request(`/leaderboard/organizations?scope=${scope}`);
  }

  // Stats
  async getDashboardStats(scope: SessionScope = 'all'): Promise<DashboardResponse> {
    // Lets the server bucket "today" and the trend by this computer's local day.
    return this.request(`/stats/dashboard?tz_offset_min=${new Date().getTimezoneOffset()}&scope=${scope}`);
  }

  async getTraineeStats(id: number): Promise<TraineeStatsResponse> {
    return this.request(`/stats/trainee/${id}`);
  }

  // Export
  async exportSessions(params?: {
    trainee_id?: number;
    start_date?: string;
    end_date?: string;
  }, format: ExportFormat = 'pdf'): Promise<Blob> {
    const query = exportQuery(format);
    if (params?.trainee_id) query.set('trainee_id', String(params.trainee_id));
    if (params?.start_date) query.set('start_date', params.start_date);
    if (params?.end_date) query.set('end_date', params.end_date);

    return this.download(`/export/sessions?${query.toString()}`);
  }

  async exportTrainees(format: ExportFormat = 'pdf'): Promise<Blob> {
    return this.download(`/export/trainees?${exportQuery(format).toString()}`);
  }

  async exportTestData(sessionId?: number, format: ExportFormat = 'pdf'): Promise<Blob> {
    const query = exportQuery(format);
    if (sessionId) query.set('session_id', String(sessionId));

    return this.download(`/export/test-data?${query.toString()}`);
  }

  /** Certificate of Practice Completion as a PDF file. */
  async getCertificatePdf(sessionId: number): Promise<Blob> {
    return this.download(`/export/certificate/${sessionId}?${exportQuery('pdf').toString()}`);
  }

  async getCertificate(sessionId: number): Promise<string> {
    const response = await this.send(`/export/certificate/${sessionId}`);
    return response.text();
  }

  // Settings
  async getSettings(): Promise<{ settings: Settings }> {
    return this.request('/settings');
  }

  async updateSettings(data: SettingsUpdateRequest): Promise<{ settings: Settings }> {
    return this.request('/settings', {
      method: 'PUT',
      body: JSON.stringify({ settings: data }),
    });
  }

  async backupDatabase(): Promise<{ message: string; path: string }> {
    return this.request('/settings/backup', { method: 'POST' });
  }

  /** Admin: a fresh copy of the whole database (.db), made now. */
  async downloadBackup(): Promise<Blob> {
    return this.download('/settings/backup/download');
  }

  /** Admin: backups kept on the server, newest first. */
  async getBackups(): Promise<{ backups: ServerBackup[]; directory: string }> {
    return this.request('/settings/backups');
  }

  async downloadServerBackup(name: string): Promise<Blob> {
    return this.download(`/settings/backups/${encodeURIComponent(name)}`);
  }

  /** Admin: every record as one readable JSON file (no password hashes). */
  async exportAllData(): Promise<Blob> {
    return this.download('/export/all');
  }

  // Users (Admin only)
  async getUsers(): Promise<{ users: User[] }> {
    return this.request('/users');
  }

  async createUser(data: { username: string; password: string; role: 'admin' | 'trainer' }): Promise<{ user: User }> {
    return this.request('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateUser(id: number, data: { username?: string; password?: string; role?: 'admin' | 'trainer'; is_active?: boolean }): Promise<{ user: User }> {
    return this.request(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteUser(id: number): Promise<{ message: string }> {
    return this.request(`/users/${id}`, { method: 'DELETE' });
  }

  // Health
  async healthCheck(): Promise<HealthResponse> {
    return this.request('/health');
  }
}

// Singleton instance
export const api = new ApiClient();

// Helper for blob downloads
export async function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}