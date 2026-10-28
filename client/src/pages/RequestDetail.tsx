import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { requestService, getErrorMessage } from '../services/api';
import Stars from '../components/Stars';
import toast from 'react-hot-toast';
import { 
  User, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Loader2, 
  Sparkles,
  ArrowLeft,
  Shield
} from 'lucide-react';
import type { CleaningRequest, CleaningStatus } from '../types';

const statusConfig: Record<CleaningStatus, { label: string; icon: React.ElementType; className: string; description: string }> = {
  PENDING: { 
    label: 'Pending', 
    icon: Clock, 
    className: 'badge-pending',
    description: 'Waiting for a cleaner to claim this request'
  },
  IN_PROGRESS: { 
    label: 'In Progress', 
    icon: Loader2, 
    className: 'badge-in-progress',
    description: 'Cleaner is currently cleaning the room'
  },
  CLEANED: { 
    label: 'Cleaned', 
    icon: CheckCircle, 
    className: 'badge-cleaned',
    description: 'Cleaner has marked the room as cleaned. Awaiting confirmation.'
  },
  CONFIRMED: { 
    label: 'Confirmed', 
    icon: CheckCircle, 
    className: 'badge-confirmed',
    description: 'Cleaning confirmed by resident. Request complete.'
  },
  REJECTED: { 
    label: 'Rejected', 
    icon: XCircle, 
    className: 'badge-rejected',
    description: 'Cleaning was rejected. Room may need re-cleaning.'
  },
};

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [request, setRequest] = useState<CleaningRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!id) return;
    loadRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadRequest = async () => {
    try {
      const data = await requestService.getById(id!);
      setRequest(data);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to load request'));
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async () => {
    setActionLoading('claim');
    try {
      const updated = await requestService.claim(id!);
      setRequest(updated);
      toast.success('Request claimed!');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to claim request'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleMarkCleaned = async () => {
    setActionLoading('clean');
    try {
      const updated = await requestService.markCleaned(id!);
      setRequest(updated);
      toast.success('Room marked as cleaned! Awaiting confirmation.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to mark as cleaned'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleConfirm = async () => {
    setActionLoading('confirm');
    try {
      const updated = await requestService.confirm(id!, { rating, feedback: comment.trim() || undefined });
      setRequest(updated);
      setShowConfirm(false);
      toast.success('Cleaning confirmed! Request complete.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to confirm'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    setActionLoading('reject');
    try {
      const updated = await requestService.reject(id!, reason.trim() || undefined);
      setRequest(updated);
      setShowReject(false);
      setReason('');
      toast.success('Request rejected. Cleaner will be notified.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to reject'));
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-12 w-12 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!request) return null;

  const config = statusConfig[request.status];
  const StatusIcon = config.icon;
  const canClaim = user?.role === 'CLEANER' && request.status === 'PENDING' && !request.cleanerId;
  const canMarkCleaned = user?.role === 'CLEANER' && request.status === 'IN_PROGRESS' && request.cleanerId === user.id;
  const canConfirm = (user?.role === 'RESIDENT' || user?.role === 'ADMIN') && 
    request.status === 'CLEANED' && 
    request.confirmedBy !== user?.id &&
    request.cleanerId !== user?.id; // Prevent cleaner from confirming own work
  const canReject = (user?.role === 'RESIDENT' || user?.role === 'ADMIN') && 
    request.status === 'CLEANED' &&
    request.cleanerId !== user?.id;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link
        to={user?.role === 'CLEANER' ? '/cleaner' : user?.role === 'ADMIN' ? '/admin' : '/dashboard'}
        className="inline-flex items-center space-x-2 text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back to Dashboard</span>
      </Link>

      <div className="card p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-4">
            <div className="p-3 bg-primary-100 rounded-xl">
              <Sparkles className="h-6 w-6 text-primary-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Cleaning Request</h1>
              <p className="text-gray-500">Room {request.room?.number} • Block {request.room?.building} • Floor {request.room?.floor}</p>
            </div>
          </div>
          <span className={`badge ${config.className} text-sm px-3 py-1`}>
            <StatusIcon className="h-3 w-3 mr-1" />
            {config.label}
          </span>
        </div>

        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center space-x-3 text-gray-700">
            <div className="p-2 bg-white rounded-lg">
              <config.icon className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <p className="font-medium">{config.label}</p>
              <p className="text-sm text-gray-500">{config.description}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-6">
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500">Requested by</p>
            <p className="font-medium flex items-center space-x-2">
              <User className="h-4 w-4 text-gray-400" />
              <span>{request.requester?.name || 'Former student'}</span>
            </p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500">Requested at</p>
            <p className="font-medium">{new Date(request.requestedAt).toLocaleString()}</p>
          </div>
          {request.cleaner && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">Assigned cleaner</p>
              <p className="font-medium flex items-center space-x-2">
                <User className="h-4 w-4 text-gray-400" />
                <span>{request.cleaner.name}</span>
              </p>
            </div>
          )}
          {request.cleanedAt && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">Marked cleaned at</p>
              <p className="font-medium">{new Date(request.cleanedAt).toLocaleString()}</p>
            </div>
          )}
          {request.confirmedAt && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">{request.status === 'REJECTED' ? 'Rejected by' : 'Confirmed by'}</p>
              <p className="font-medium flex items-center space-x-2">
                <Shield className="h-4 w-4 text-gray-400" />
                <span>{request.confirmer?.name || 'Unknown'}</span>
              </p>
            </div>
          )}
          {request.rating ? (
            <div className="p-4 bg-gray-50 rounded-lg sm:col-span-2">
              <p className="text-sm text-gray-500">Feedback</p>
              <Stars value={request.rating} />
              {request.feedback && <p className="mt-1 text-gray-700">{request.feedback}</p>}
            </div>
          ) : null}
          {request.confirmedAt && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">{request.status === 'REJECTED' ? 'Rejected at' : 'Confirmed at'}</p>
              <p className="font-medium">{new Date(request.confirmedAt).toLocaleString()}</p>
            </div>
          )}
        </div>

        <div className="mt-6 pt-6 border-t border-gray-200 flex flex-wrap gap-3">
          <Link
            to={user?.role === 'CLEANER' ? '/cleaner' : user?.role === 'ADMIN' ? '/admin' : '/dashboard'}
            className="btn btn-outline flex-1 sm:flex-none"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Link>

          {canClaim && (
            <button
              onClick={handleClaim}
              disabled={actionLoading === 'claim'}
              className="btn btn-primary flex-1 sm:flex-none"
            >
              {actionLoading === 'claim' ? (
                <span className="flex items-center justify-center space-x-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Claiming...</span>
                </span>
              ) : (
                'Claim Request'
              )}
            </button>
          )}

          {canMarkCleaned && (
            <button
              onClick={handleMarkCleaned}
              disabled={actionLoading === 'clean'}
              className="btn btn-primary flex-1 sm:flex-none"
            >
              {actionLoading === 'clean' ? (
                <span className="flex items-center justify-center space-x-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Marking...</span>
                </span>
              ) : (
                'Mark as Cleaned'
              )}
            </button>
          )}

          {canConfirm && !showConfirm && (
            <button
              onClick={() => setShowConfirm(true)}
              className="btn bg-green-600 text-white hover:bg-green-700 flex-1 sm:flex-none"
            >
              Confirm Cleaning
            </button>
          )}

          {canReject && !showReject && (
            <button onClick={() => setShowReject(true)} className="btn btn-danger flex-1 sm:flex-none">
              Reject Cleaning
            </button>
          )}
        </div>

        {canConfirm && showConfirm && (
          <div className="mt-4 space-y-3" aria-labelledby="feedback-heading">
            <h3 id="feedback-heading" className="text-sm font-medium text-gray-700">How was the cleaning?</h3>
            <Stars value={rating} onChange={setRating} />
            <label htmlFor="feedback-comment" className="block text-sm font-medium text-gray-700">Feedback (optional)</label>
            <textarea
              id="feedback-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
              rows={3}
              className="w-full rounded-lg border border-gray-300 p-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={handleConfirm}
                disabled={rating === 0 || actionLoading === 'confirm'}
                className="btn bg-green-600 text-white hover:bg-green-700"
              >
                {actionLoading === 'confirm' ? 'Confirming...' : 'Submit and confirm'}
              </button>
              <button onClick={() => setShowConfirm(false)} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        )}

        {canReject && showReject && (
          <div className="mt-4 space-y-3">
            <label htmlFor="reject-reason" className="block text-sm font-medium text-gray-700">
              Reason for rejection (optional)
            </label>
            <textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              className="w-full rounded-lg border border-gray-300 p-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={handleReject}
                disabled={actionLoading === 'reject'}
                className="btn btn-danger"
              >
                {actionLoading === 'reject' ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
              <button onClick={() => setShowReject(false)} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Status Timeline */}
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Status Timeline</h3>
          <div className="space-y-4">
            <TimelineItem
              title="Request Created"
              time={request.requestedAt}
              icon={<Sparkles className="h-5 w-5 text-primary-600" />}
              active={true}
            />
            {request.cleanerId && (
              <TimelineItem
                title="Claimed by Cleaner"
                time={request.claimedAt || request.updatedAt}
                icon={<User className="h-5 w-5 text-blue-600" />}
                active={['IN_PROGRESS', 'CLEANED', 'CONFIRMED', 'REJECTED'].includes(request.status)}
              />
            )}
            {request.status !== 'PENDING' && request.status !== 'IN_PROGRESS' && (
              <TimelineItem
                title="Marked as Cleaned"
                time={request.cleanedAt || request.updatedAt}
                icon={<CheckCircle className="h-5 w-5 text-green-600" />}
                active={['CLEANED', 'CONFIRMED', 'REJECTED'].includes(request.status)}
              />
            )}
            {request.status === 'CONFIRMED' && request.confirmedAt && (
              <TimelineItem
                title="Confirmed"
                time={request.confirmedAt}
                icon={<Shield className="h-5 w-5 text-purple-600" />}
                active={true}
                last
              />
            )}
            {request.status === 'REJECTED' && (
              <TimelineItem
                title={request.rejectReason ? `Rejected: ${request.rejectReason}` : 'Rejected'}
                time={request.updatedAt}
                icon={<XCircle className="h-5 w-5 text-red-600" />}
                active={true}
                last
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineItem({ 
  title, 
  time, 
  icon, 
  active, 
  last 
}: { 
  title: string; 
  time: string; 
  icon: React.ReactNode; 
  active: boolean; 
  last?: boolean; 
}) {
  return (
    <div className={`relative flex items-start space-x-4 ${active ? '' : 'opacity-50'}`}>
      {!last && <div className="absolute left-5 top-10 -bottom-4 w-0.5 bg-gray-200" />}
      <div className="relative flex items-center justify-center h-10 w-10 rounded-full bg-white border-2 border-gray-200 z-10 flex-shrink-0">
        {icon}
      </div>
      <div className="relative flex-1 pt-1">
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <p className="font-medium text-gray-900">{title}</p>
          <p className="text-sm text-gray-500 mt-1">{new Date(time).toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}