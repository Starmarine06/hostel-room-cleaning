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
  Loader2, 
  Filter,
  RefreshCw,
} from 'lucide-react';
import type { CleaningRequest, CleaningStatus } from '../types';

const statusConfig: Record<CleaningStatus, { label: string; icon: React.ElementType; className: string }> = {
  PENDING: { label: 'Pending', icon: Clock, className: 'badge-pending' },
  IN_PROGRESS: { label: 'In Progress', icon: Loader2, className: 'badge-in-progress' },
  CLEANED: { label: 'Cleaned', icon: CheckCircle, className: 'badge-cleaned' },
  CONFIRMED: { label: 'Confirmed', icon: CheckCircle, className: 'badge-confirmed' },
  REJECTED: { label: 'Rejected', icon: Clock, className: 'badge-rejected' },
};

export default function CleanerDashboard() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [requests, setRequests] = useState<CleaningRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CleaningStatus | 'ALL'>('ALL');
  const [myRequests, setMyRequests] = useState<CleaningRequest[]>([]);

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
      setMyRequests(prev => 
        prev.map(r => r.id === updatedRequest.id ? updatedRequest : r)
      );
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
  }, [socket]);

  const loadRequests = async () => {
    try {
      const [allResponse, myResponse] = await Promise.all([
        requestService.getAll(),
        requestService.getAll({ cleanerId: user?.id }),
      ]);
      setRequests(allResponse.data || allResponse);
      setMyRequests(myResponse.data || myResponse);
    } catch (error) {
      toast.error('Failed to load requests');
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async (requestId: string) => {
    try {
      const updated = await requestService.claim(requestId);
      setRequests(prev => prev.map(r => r.id === requestId ? updated : r));
      setMyRequests(prev => [updated, ...prev]);
      toast.success('Request claimed!');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to claim request'));
    }
  };

  const filteredRequests = requests.filter(r => 
    filter === 'ALL' || r.status === filter
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-12 w-12 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cleaner Dashboard</h1>
          <p className="text-gray-600 mt-1">Welcome, {user?.name}</p>
        </div>
      </div>

      {/* My Active Requests */}
      {myRequests.length > 0 && (
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
              <Sparkles className="h-5 w-5 text-primary-600" />
              <span>My Active Requests</span>
            </h2>
          </div>
          <div className="divide-y divide-gray-100">
            {myRequests.map((request) => {
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
                      <div className={`p-2 rounded-lg ${
                        request.status === 'IN_PROGRESS' ? 'bg-blue-100' : 
                        request.status === 'CLEANED' ? 'bg-green-100' : 
                        'bg-yellow-100'
                      }`}>
                        <StatusIcon className={`h-5 w-5 ${
                          request.status === 'IN_PROGRESS' ? 'text-blue-600' : 
                          request.status === 'CLEANED' ? 'text-green-600' : 
                          'text-yellow-600'
                        }`} />
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
                        </p>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Available Requests */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
            <Building2 className="h-5 w-5 text-primary-600" />
            <span>Available Requests</span>
          </h2>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as CleaningStatus | 'ALL')}
            className="input w-auto px-3 py-1 text-sm"
          >
            <option value="ALL">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="IN_PROGRESS">In Progress</option>
          </select>
        </div>
        <div className="divide-y divide-gray-100">
          {filteredRequests.filter(r => !myRequests.find(m => m.id === r.id)).length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Filter className="h-12 w-12 mx-auto text-gray-300" />
              <h3 className="mt-4 text-lg font-medium text-gray-900">No available requests</h3>
              <p className="mt-2 text-gray-500">
                {filter === 'ALL' ? 'All caught up! New requests will appear here.' : 'No requests with this status.'}
              </p>
            </div>
          ) : (
            filteredRequests
              .filter(r => !myRequests.find(m => m.id === r.id))
              .map((request) => {
                const config = statusConfig[request.status];
                const StatusIcon = config.icon;
                return (
                  <div key={request.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="p-2 bg-gray-100 rounded-lg">
                          <Sparkles className="h-5 w-5 text-gray-600" />
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
                            Requested {new Date(request.requestedAt).toLocaleString()} by {request.requester?.name}
                          </p>
                        </div>
                      </div>
                      {request.status === 'PENDING' && (
                        <button
                          onClick={() => handleClaim(request.id)}
                          className="btn btn-primary text-sm"
                        >
                          Claim
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
          )}
        </div>
      </div>
    </div>
  );
}