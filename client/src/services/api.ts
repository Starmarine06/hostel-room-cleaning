import axios from 'axios';
import type { AuthResponse, User, Room, ImportResult, PaginatedResponse } from '../types';

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

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
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

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await api.post('/auth/change-password', { currentPassword, newPassword });
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

  async confirm(id: string) {
    const { data } = await api.post(`/requests/${id}/confirm`);
    return data;
  },

  async reject(id: string, reason?: string) {
    const { data } = await api.post(`/requests/${id}/reject`, { reason });
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

  async create(person: { email: string; name?: string; role: 'RESIDENT' | 'CLEANER'; room?: string }): Promise<{ user: User; tempPassword: string }> {
    const { data } = await api.post('/users', person);
    return data;
  },

  async importCsv(csv: string, createMissingRooms: boolean): Promise<ImportResult> {
    const { data } = await api.post<ImportResult>('/users/import', { csv, createMissingRooms });
    return data;
  },

  async resetPassword(id: string): Promise<{ email: string; tempPassword: string }> {
    const { data } = await api.post(`/users/${id}/reset-password`);
    return data;
  },

  async delete(id: string) {
    await api.delete(`/users/${id}`);
  },
};