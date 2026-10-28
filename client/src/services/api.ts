import axios from 'axios';
import type { AuthResponse, User, Room, ImportResult, PaginatedResponse, ReportRow, RatingReport, CleaningRequest } from '../types';

export function getErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; errors?: { message?: string }[] } | undefined;
    // Validation errors carry the useful detail in errors[0]
    return data?.errors?.[0]?.message || data?.message || fallback;
  }
  return fallback;
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// The hosting platform can briefly answer 502/503/504 (for example while an instance restarts).
// Reads are always safe to repeat. A write is only repeated when the answer is clearly the platform's
// own error page (not our JSON), which means the request never reached the app.
api.interceptors.response.use(undefined, async (error) => {
  const config = error.config as (typeof error.config & { _retried?: boolean }) | undefined;
  const status = error.response?.status;
  const platformError = status === 502 || status === 503 || status === 504;
  const fromApp = typeof error.response?.data === 'object' && error.response?.data?.message;
  const transient = !error.response || (platformError && !fromApp);
  const safeToRepeat = config?.method === 'get' || (platformError && !fromApp);
  if (config && safeToRepeat && transient && !config._retried) {
    config._retried = true;
    await new Promise((resolve) => setTimeout(resolve, 800));
    return api(config);
  }
  return Promise.reject(error);
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // An issued password may only be used to choose a new one
    if (error.response?.status === 403 && error.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED') {
      if (!window.location.pathname.endsWith('/profile')) window.location.href = `${import.meta.env.BASE_URL}profile`;
    }
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = `${import.meta.env.BASE_URL}login`;
    }
    return Promise.reject(error);
  }
);

export const authService = {
  async login(email: string, password: string): Promise<AuthResponse> {
    const { data } = await api.post<AuthResponse>('/auth/login', { email, password });
    return data;
  },

  async google(credential: string): Promise<AuthResponse> {
    const { data } = await api.post<AuthResponse>('/auth/google', { credential });
    return data;
  },

  async config(): Promise<{ googleClientId: string | null }> {
    const { data } = await api.get('/auth/config');
    return data;
  },

  async getMe(): Promise<User> {
    const { data } = await api.get<User>('/auth/me');
    return data;
  },

  async updateProfile(data: Partial<User>): Promise<User> {
    const { data: user } = await api.patch<User>('/auth/profile', data);
    return user;
  },

  // Returns a fresh sign-in token: changing the password closes the older sessions
  async changePassword(currentPassword: string, newPassword: string): Promise<string> {
    const { data } = await api.post<{ token: string }>('/auth/change-password', { currentPassword, newPassword });
    return data.token;
  },
};

export const roomService = {
  async getAll(params?: { page?: number; limit?: number }): Promise<PaginatedResponse<Room>> {
    const { data } = await api.get('/rooms', { params });
    return data;
  },

  async getById(id: string): Promise<Room> {
    const { data } = await api.get(`/rooms/${id}`);
    return data;
  },

  async create(roomData: { number: string; capacity?: number }): Promise<Room> {
    const { data } = await api.post('/rooms', roomData);
    return data;
  },

  async update(id: string, roomData: Partial<{ number: string; capacity: number }>): Promise<Room> {
    const { data } = await api.patch(`/rooms/${id}`, roomData);
    return data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/rooms/${id}`);
  },

  async assignResident(roomId: string, userId: string): Promise<User> {
    const { data } = await api.post(`/rooms/${roomId}/residents`, { userId });
    return data;
  },

  async removeResident(roomId: string, userId: string): Promise<void> {
    await api.delete(`/rooms/${roomId}/residents/${userId}`);
  },
};

export const requestService = {
  async getAll(params?: { status?: string; roomId?: string; cleanerId?: string; page?: number; limit?: number }) {
    const { data } = await api.get('/requests', { params });
    return data;
  },

  async getById(id: string) {
    const { data } = await api.get(`/requests/${id}`);
    return data;
  },

  async create(roomId: string) {
    const { data } = await api.post('/requests', { roomId });
    return data;
  },

  async claim(id: string) {
    const { data } = await api.post(`/requests/${id}/claim`);
    return data;
  },

  async markCleaned(id: string) {
    const { data } = await api.post(`/requests/${id}/cleaned`);
    return data;
  },

  async confirm(id: string, feedback?: { rating: number; feedback?: string }) {
    const { data } = await api.post(`/requests/${id}/confirm`, feedback ?? {});
    return data;
  },

  async reject(id: string, reason?: string) {
    const { data } = await api.post(`/requests/${id}/reject`, { reason });
    return data;
  },
};

export const reportService = {
  async get(
    kind: 'blocks' | 'rooms' | 'ratings',
    params: { from?: string; to?: string; block?: string }
  ): Promise<{ data: ReportRow[]; blocks?: ReportRow[]; rooms?: ReportRow[]; comments?: RatingReport['comments'] }> {
    const { data } = await api.get(`/reports/${kind}`, { params });
    return data;
  },

  async overdue(): Promise<{ thresholdHours: number; data: (CleaningRequest & { hoursWaiting: number })[] }> {
    const { data } = await api.get('/reports/overdue');
    return data;
  },
};

export const userService = {
  async getAll(params?: { role?: string; page?: number; limit?: number }) {
    const { data } = await api.get('/users', { params });
    return data;
  },

  async getById(id: string) {
    const { data } = await api.get(`/users/${id}`);
    return data;
  },

  async update(id: string, userData: Partial<User>) {
    const { data } = await api.patch(`/users/${id}`, userData);
    return data;
  },

  async create(person: { email: string; name?: string; role: 'RESIDENT' | 'CLEANER'; room?: string; regNo?: string }): Promise<{ user: User; tempPassword: string | null; emailed: boolean }> {
    const { data } = await api.post('/users', person);
    return data;
  },

  async importCsv(csv: string, removeMissing = false): Promise<ImportResult> {
    const { data } = await api.post<ImportResult>('/users/import', { csv, removeMissing });
    return data;
  },

  async resetPassword(id: string): Promise<{ email: string; tempPassword: string | null; emailed: boolean }> {
    const { data } = await api.post(`/users/${id}/reset-password`);
    return data;
  },

  async delete(id: string) {
    await api.delete(`/users/${id}`);
  },
};