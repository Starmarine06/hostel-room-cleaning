export type Role = 'RESIDENT' | 'CLEANER' | 'ADMIN';
export type CleaningStatus = 'PENDING' | 'IN_PROGRESS' | 'CLEANED' | 'CONFIRMED' | 'REJECTED';

export interface User {
  id: string;
  email: string;
  regNo?: string | null;
  mustChangePassword?: boolean;
  name: string;
  role: Role;
  roomId: string | null;
  room?: Room | null;
  createdAt: string;
  updatedAt: string;
}

export interface Room {
  id: string;
  number: string;
  building: string;
  floor: number;
  capacity: number;
  residents?: User[];
  requests?: CleaningRequest[];
  createdAt: string;
  updatedAt: string;
}

export interface CleaningRequest {
  id: string;
  roomId: string;
  room?: Room;
  requestedBy: string;
  requester?: User;
  status: CleaningStatus;
  cleanerId: string | null;
  cleaner?: User | null;
  confirmedBy: string | null;
  confirmer?: User | null;
  requestedAt: string;
  claimedAt?: string | null;
  cleanedAt: string | null;
  confirmedAt: string | null;
  rejectReason?: string | null;
  rating?: number | null;
  feedback?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ReportRow = Record<string, string | number | null>;

export interface RatingReport {
  data: ReportRow[];
  blocks: ReportRow[];
  rooms: ReportRow[];
  comments: { room: string; cleaner: string; rating: number | null; feedback: string | null; at: string | null }[];
}

export interface ImportResult {
  summary: { total: number; created: number; assigned: number; moved: number; unchanged: number; failed: number };
  failures: { row: number; email: string; message: string }[];
  // Only people whose password could not be emailed; the admin passes these on
  newAccounts: { email: string; password: string }[];
  emailed: number;
  mailEnabled: boolean;
  removed: number;
  removalSkipped?: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface ApiError {
  message: string;
  statusCode: number;
  errors?: Record<string, string[]>;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface Credential {
  email: string;
  password: string;
}
