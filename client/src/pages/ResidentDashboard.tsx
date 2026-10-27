import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { requestService, getErrorMessage } from '../services/api';
import toast from 'react-hot-toast';
import { 
  Building2, 
  Sparkles, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Loader2, 
  AlertCircle,
  Plus 
} from 'lucide-react';
import type { CleaningRequest, CleaningStatus } from '../types';

const statusConfig: Record<CleaningStatus, { label: string; icon: React.ElementType; className: string }> = {
  PENDING: { label: 'Pending', icon: Clock, className: 'badge-pending' },
  IN_PROGRESS: { label: 'In Progress', icon: Loader2, className: 'badge-in-progress' },
  CLEANED: { label: 'Cleaned', icon: CheckCircle, className: 'badge-cleaned' },
  CONFIRMED: { label: 'Confirmed', icon: CheckCircle, className: 'badge-confirmed' },
  REJECTED: { label: 'Rejected', icon: XCircle, className: 'badge-rejected' },
};

export default function ResidentDashboard() {
  const { user, refreshUser } = useAuth();
  const { socket } = useSocket();
  const [requests, setRequests] = useState<CleaningRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [activeRequest, setActiveRequest] = useState<CleaningRequest | null>(null);

  useEffect(() => {
    loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handleRequestUpdate = (updatedRequest: CleaningRequest) => {
      setRequests(prev => 
        prev.map(r => r.id === updatedRequest.id ? updatedRequest : r)
      );
      if (activeRequest?.id === updatedRequest.id) {
        setActiveRequest(updatedRequest);
      }
      // Refresh user in case room assignment changed
      refreshUser();
    };

    const handleNewRequest = (newRequest: CleaningRequest) => {
      // The person who created it also receives this event, so skip it if it is already listed
      setRequests(prev => (prev.some(r => r.id === newRequest.id) ? prev : [newRequest, ...prev]));
      toast.success(`New cleaning request for Room ${newRequest.room?.number}`);
    };

    socket.on('request:updated', handleRequestUpdate);
    socket.on('request:created', handleNewRequest);
    socket.on('resync', loadRequests); // after a reconnect, catch up on anything missed

    return () => {
      socket.off('request:updated', handleRequestUpdate);
      socket.off('request:created', handleNewRequest);
      socket.off('resync', loadRequests);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, refreshUser, activeRequest]);

  const loadRequests = async () => {
    try {
      const response = await requestService.getAll({ roomId: user?.roomId ?? undefined });
      setRequests(response.data || response);
    } catch (error) {
      toast.error('Failed to load requests');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRequest = async () => {
    if (!user?.roomId) {
      toast.error('You are not assigned to a room');
      return;
    }

    // Check for existing pending/in-progress request
    const existingRequest = requests.find(
      r => r.roomId === user.roomId && 
      ['PENDING', 'IN_PROGRESS'].includes(r.status)
    );

    if (existingRequest) {
      toast.error('A cleaning request is already active for this room');
      return;
    }

    setCreating(true);
    try {
      await requestService.create(user.roomId);
      toast.success('Cleaning request submitted!');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to create request'));
    } finally {
      setCreating(false);
    }
  };

  const hasActiveRequest = requests.some(
    r => r.roomId === user?.roomId && ['PENDING', 'IN_PROGRESS'].includes(r.status)
  );

  const roomRequests = requests.filter(r => r.roomId === user?.roomId);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-12 w-12 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-1">
            Welcome back, {user?.name}! Room: {user?.room?.number || 'Not assigned'}
          </p>
        </div>
        <button
          onClick={handleCreateRequest}
          disabled={creating || hasActiveRequest || !user?.roomId}
          className="btn btn-primary flex items-center space-x-2"
        >
          <Plus className="h-4 w-4" />
          <span>{creating ? 'Requesting...' : hasActiveRequest ? 'Request Active' : 'Request Cleaning'}</span>
        </button>
      </div>

      {!user?.roomId && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          You are not assigned to a room yet. Ask an admin to assign you one, then you can request cleaning.
        </div>
      )}

      {hasActiveRequest && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <AlertCircle className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-medium text-blue-900">Active Cleaning Request</h3>
              <p className="text-sm text-blue-700">
                You already have a cleaning request in progress. Please wait for it to complete before creating a new one.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Cleaning Requests</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {roomRequests.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Building2 className="h-12 w-12 mx-auto text-gray-300" />
              <h3 className="mt-4 text-lg font-medium text-gray-900">No cleaning requests yet</h3>
              <p className="mt-2 text-gray-500">Click "Request Cleaning" to ask for room cleaning</p>
            </div>
          ) : (
            roomRequests.map((request) => {
              const config = statusConfig[request.status];
              const StatusIcon = config.icon;
              return (
                <Link
                  key={request.id}
                  to={`/request/${request.id}`}
                  className="block px-6 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="p-2 bg-primary-100 rounded-lg">
                        <Sparkles className="h-5 w-5 text-primary-600" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-3">
                          <h3 className="font-medium text-gray-900">Room {request.room?.number}</h3>
                          <span className={`badge ${config.className}`}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {config.label}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          Requested {new Date(request.requestedAt).toLocaleString()}
                          {request.cleaner && ` • Cleaner: ${request.cleaner.name}`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-500">View details</p>
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}