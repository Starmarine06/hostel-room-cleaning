import { useState, useEffect } from 'react';
import { roomService, userService, requestService, getErrorMessage } from '../services/api';
import toast from 'react-hot-toast';
import PeoplePanel from '../components/PeoplePanel';
import CredentialsNotice from '../components/CredentialsNotice';
import { 
  Building2, 
  Users, 
  Sparkles, 
  Plus, 
  Edit, 
  Trash2,
  Loader2,
  XCircle,
  Search,
  KeyRound,
} from 'lucide-react';
import type { Room, User, CleaningRequest, CleaningStatus, Role, Credential } from '../types';

const statusConfig: Record<CleaningStatus, { label: string; className: string }> = {
  PENDING: { label: 'Pending', className: 'badge-pending' },
  IN_PROGRESS: { label: 'In Progress', className: 'badge-in-progress' },
  CLEANED: { label: 'Cleaned', className: 'badge-cleaned' },
  CONFIRMED: { label: 'Confirmed', className: 'badge-confirmed' },
  REJECTED: { label: 'Rejected', className: 'badge-rejected' },
};

const roleConfig: Record<Role, { label: string; className: string }> = {
  RESIDENT: { label: 'Resident', className: 'bg-blue-100 text-blue-800' },
  CLEANER: { label: 'Cleaner', className: 'bg-green-100 text-green-800' },
  ADMIN: { label: 'Admin', className: 'bg-purple-100 text-purple-800' },
};

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<'rooms' | 'users' | 'requests'>('rooms');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [requests, setRequests] = useState<CleaningRequest[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({ rooms: true, users: true, requests: true });
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [roomForm, setRoomForm] = useState({ number: '', capacity: 4 });
  const [credentials, setCredentials] = useState<Credential[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [requestFilter, setRequestFilter] = useState<CleaningStatus | 'ALL'>('ALL');

  useEffect(() => {
    loadRooms();
    loadUsers();
    loadRequests();
  }, []);

  const loadRooms = async () => {
    setLoading(prev => ({ ...prev, rooms: true }));
    try {
      const response = await roomService.getAll({ limit: 500 });
      setRooms(response.data || response);
    } catch (error) {
      toast.error('Failed to load rooms');
    } finally {
      setLoading(prev => ({ ...prev, rooms: false }));
    }
  };

  const loadUsers = async () => {
    setLoading(prev => ({ ...prev, users: true }));
    try {
      const response = await userService.getAll({ limit: 500 });
      setUsers(response.data || response);
    } catch (error) {
      toast.error('Failed to load users');
    } finally {
      setLoading(prev => ({ ...prev, users: false }));
    }
  };

  const loadRequests = async () => {
    setLoading(prev => ({ ...prev, requests: true }));
    try {
      const response = await requestService.getAll({ limit: 500 });
      setRequests(response.data || response);
    } catch (error) {
      toast.error('Failed to load requests');
    } finally {
      setLoading(prev => ({ ...prev, requests: false }));
    }
  };

  const handleResetPassword = async (userId: string) => {
    if (!confirm('Give this person a new temporary password? Their old password will stop working.')) return;
    try {
      const res = await userService.resetPassword(userId);
      setCredentials([{ email: res.email, password: res.tempPassword }]);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not reset password'));
    }
  };

  const handleRoomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingRoom) {
        await roomService.update(editingRoom.id, roomForm);
        toast.success('Room updated');
      } else {
        await roomService.create(roomForm);
        toast.success('Room created');
      }
      setShowRoomModal(false);
      setEditingRoom(null);
      setRoomForm({ number: '', capacity: 4 });
      loadRooms();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to save room'));
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    if (!confirm('Are you sure you want to delete this room?')) return;
    try {
      await roomService.delete(roomId);
      toast.success('Room deleted');
      loadRooms();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to delete room'));
    }
  };

  const handleAssignResident = async (roomId: string, userId: string) => {
    try {
      await roomService.assignResident(roomId, userId);
      toast.success('Resident assigned');
      loadRooms();
      loadUsers();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to assign resident'));
    }
  };

  const handleRemoveResident = async (roomId: string, userId: string) => {
    try {
      await roomService.removeResident(roomId, userId);
      toast.success('Resident removed');
      loadRooms();
      loadUsers();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to remove resident'));
    }
  };

  const handleUpdateUserRole = async (userId: string, role: Role) => {
    try {
      await userService.update(userId, { role });
      toast.success('User role updated');
      loadUsers();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update role'));
    }
  };

  const filteredRooms = rooms.filter(r => 
    r.number.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.building.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredRequests = requests.filter(r => 
    requestFilter === 'ALL' || r.status === requestFilter
  );

  const tabs = [
    { id: 'rooms', label: 'Rooms', icon: Building2, count: rooms.length },
    { id: 'users', label: 'Users', icon: Users, count: users.length },
    { id: 'requests', label: 'Requests', icon: Sparkles, count: requests.length },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-gray-600 mt-1">Manage rooms, users, and cleaning requests</p>
        </div>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex space-x-8" aria-label="Admin tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex items-center space-x-2 px-4 py-4 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{tab.label}</span>
                <span className="px-2 py-0.5 text-xs bg-gray-100 rounded-full">{tab.count}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === 'rooms' && (
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Room Management</h2>
            <button
              onClick={() => {
                setEditingRoom(null);
                setRoomForm({ number: '', capacity: 4 });
                setShowRoomModal(true);
              }}
              className="btn btn-primary flex items-center space-x-2"
            >
              <Plus className="h-4 w-4" />
              <span>Add Room</span>
            </button>
          </div>

          <div className="p-4 border-b border-gray-100">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search rooms..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input pl-10"
              />
            </div>
          </div>

          {loading.rooms ? (
            <div className="p-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary-600 mx-auto" />
            </div>
          ) : filteredRooms.length === 0 ? (
            <div className="p-8 text-center">
              <Building2 className="h-12 w-12 mx-auto text-gray-300" />
              <h3 className="mt-4 text-lg font-medium text-gray-900">No rooms found</h3>
              <p className="mt-2 text-gray-500">Click "Add Room" to create your first room</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredRooms.map((room) => (
                <div key={room.id} className="px-6 py-4 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="p-2 bg-primary-100 rounded-lg">
                        <Building2 className="h-5 w-5 text-primary-600" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-3">
                          <h3 className="font-medium text-gray-900">Room {room.number}</h3>
                          <span className="text-sm text-gray-500">Block {room.building} • Floor {room.floor}</span>
                          <span className="px-2 py-0.5 text-xs bg-gray-100 rounded-full text-gray-600">
                            {room.residents?.length || 0}/{room.capacity}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500">
                          {room.residents?.map(r => r.name).join(', ') || 'No residents assigned'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => {
                          setEditingRoom(room);
                          setRoomForm({ number: room.number, capacity: room.capacity });
                          setShowRoomModal(true);
                        }}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                        aria-label="Edit room"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      {(room.residents?.length || 0) === 0 && (
                        <button
                          onClick={() => handleDeleteRoom(room.id)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          aria-label="Delete room"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {room.residents && room.residents.length > 0 && (
                    <div className="mt-4 ml-12 pt-4 border-t border-gray-100">
                      <div className="flex flex-wrap gap-2">
                        {room.residents.map((resident) => (
                          <span key={resident.id} className="flex items-center space-x-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-sm">
                            <span>{resident.name}</span>
                            <button
                              onClick={() => handleRemoveResident(room.id, resident.id)}
                              className="text-blue-500 hover:text-blue-700"
                              aria-label="Remove resident"
                            >
                              <XCircle className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                        {(room.residents.length < room.capacity) && (
                          <select
                            className="input py-1 px-2 text-sm w-auto"
                            onChange={(e) => e.target.value && handleAssignResident(room.id, e.target.value)}
                          >
                            <option value="">+ Assign resident</option>
                            {users
                              .filter(u => u.role === 'RESIDENT' && u.roomId !== room.id)
                              .map((user) => (
                                <option key={user.id} value={user.id}>
                                  {user.name} ({user.email}){user.roomId ? ` - moves from room ${rooms.find((r) => r.id === user.roomId)?.number ?? ''}` : ''}
                                </option>
                              ))}
                          </select>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'users' && (
        <div className="space-y-6">
          {credentials && <CredentialsNotice accounts={credentials} onClose={() => setCredentials(null)} />}
          <PeoplePanel
            onChanged={() => {
              loadUsers();
              loadRooms();
            }}
            onCredentials={setCredentials}
          />
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">User Management</h2>
          </div>

          {loading.users ? (
            <div className="p-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary-600 mx-auto" />
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {users.map((user) => (
                <div key={user.id} className="px-6 py-4 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="p-2 bg-gray-100 rounded-lg">
                        <Users className="h-5 w-5 text-gray-600" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-3">
                          <h3 className="font-medium text-gray-900">{user.name}</h3>
                          <span className="text-sm text-gray-500">{user.email}</span>
                          <span className={`badge ${roleConfig[user.role].className}`}>
                            {roleConfig[user.role].label}
                          </span>
                          {user.room && (
                            <span className="px-2 py-0.5 text-xs bg-gray-100 rounded-full text-gray-600">
                              Room {user.room.number}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleResetPassword(user.id)}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                        title="Give this person a new temporary password"
                        aria-label={`Reset password for ${user.name}`}
                      >
                        <KeyRound className="h-4 w-4" />
                      </button>
                      <select
                        value={user.role}
                        onChange={(e) => handleUpdateUserRole(user.id, e.target.value as Role)}
                        className="input py-1 px-2 text-sm w-auto"
                      >
                        <option value="RESIDENT">Resident</option>
                        <option value="CLEANER">Cleaner</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
      )}

      {activeTab === 'requests' && (
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">All Cleaning Requests</h2>
            <select
              value={requestFilter}
              onChange={(e) => setRequestFilter(e.target.value as CleaningStatus | 'ALL')}
              className="input w-auto px-3 py-1 text-sm"
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="CLEANED">Cleaned</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>

          {loading.requests ? (
            <div className="p-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary-600 mx-auto" />
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="p-8 text-center">
              <Sparkles className="h-12 w-12 mx-auto text-gray-300" />
              <h3 className="mt-4 text-lg font-medium text-gray-900">No requests found</h3>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredRequests.map((request) => (
                <div key={request.id} className="px-6 py-4 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="p-2 bg-primary-100 rounded-lg">
                        <Sparkles className="h-5 w-5 text-primary-600" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-3">
                          <h3 className="font-medium text-gray-900">Room {request.room?.number}</h3>
                          <span className={`badge ${statusConfig[request.status].className}`}>
                            {statusConfig[request.status].label}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          Requested by {request.requester?.name} at {new Date(request.requestedAt).toLocaleString()}
                          {request.cleaner && ` • Cleaner: ${request.cleaner.name}`}
                          {request.confirmer && ` • Confirmed by: ${request.confirmer.name}`}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Room Modal */}
      {showRoomModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={() => setShowRoomModal(false)} />
            <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {editingRoom ? 'Edit Room' : 'Add Room'}
              </h3>
              <form onSubmit={handleRoomSubmit} className="space-y-4">
                <div>
                  <label htmlFor="number" className="block text-sm font-medium text-gray-700 mb-1">Room Number</label>
                  <input
                    id="number"
                    type="text"
                    value={roomForm.number}
                    onChange={(e) => setRoomForm(prev => ({ ...prev, number: e.target.value }))}
                    className="input"
                    placeholder="T-230"
                    aria-describedby="number-hint"
                    required
                  />
                  <p id="number-hint" className="mt-1 text-xs text-gray-500">
                    Block, a dash, then the room number. Example: T-230
                  </p>
                </div>
                <div>
                  <label htmlFor="capacity" className="block text-sm font-medium text-gray-700 mb-1">Beds in this room</label>
                  <input
                    id="capacity"
                    type="number"
                    value={roomForm.capacity}
                    onChange={(e) => setRoomForm(prev => ({ ...prev, capacity: parseInt(e.target.value) }))}
                    className="input"
                    required
                    min="1"
                    max="10"
                  />
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowRoomModal(false);
                      setEditingRoom(null);
                      setRoomForm({ number: '', capacity: 4 });
                    }}
                    className="btn btn-outline"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    {editingRoom ? 'Update' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}