import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { FileDown, Loader2 } from 'lucide-react';
import { reportService, getErrorMessage } from '../services/api';
import { downloadCsv } from '../utils/download';
import Stars from './Stars';
import type { ReportRow, RatingReport } from '../types';

type Kind = 'blocks' | 'rooms' | 'ratings';

const kinds: { id: Kind; label: string }[] = [
  { id: 'blocks', label: 'By block' },
  { id: 'rooms', label: 'By room' },
  { id: 'ratings', label: 'Ratings' },
];

const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

const csvCell = (v: unknown) => {
  let text = v === null || v === undefined ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export default function ReportsPanel() {
  const [kind, setKind] = useState<Kind>('blocks');
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [block, setBlock] = useState('');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [ratingRows, setRatingRows] = useState<{ cleaner: ReportRow[]; block: ReportRow[]; room: ReportRow[] }>({ cleaner: [], block: [], room: [] });
  const [group, setGroup] = useState<'cleaner' | 'block' | 'room'>('block');
  const [comments, setComments] = useState<RatingReport['comments']>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Local midnight to local end of day, so the dates mean what the admin sees on the calendar
      const params = {
        from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
        block: kind === 'rooms' && block ? block : undefined,
      };
      const report = await reportService.get(kind, params);
      setRows(report.data);
      setRatingRows({ cleaner: report.data, block: report.blocks ?? [], room: report.rooms ?? [] });
      setComments(report.comments ?? []);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not load the report'));
    } finally {
      setLoading(false);
    }
  }, [kind, from, to, block]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = kind === 'ratings' ? ratingRows[group] : rows;
  const lead = kind === 'ratings' ? group : kind === 'blocks' ? 'block' : 'room';
  const first = { key: lead, label: lead[0].toUpperCase() + lead.slice(1) };
  const columns: { key: string; label: string }[] = [
    first,
    ...(lead === 'room' ? [{ key: 'block', label: 'Block' }] : []),
    { key: 'requests', label: 'Requests' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'open', label: 'Open' },
    { key: 'late', label: 'Over 4 hrs' },
    { key: 'avgHoursToClean', label: 'Avg hours to clean' },
    { key: 'ratingCount', label: 'Ratings' },
    { key: 'avgRating', label: 'Avg rating' },
  ];

  const download = () => {
    const lines = [columns.map((c) => c.label), ...shown.map((r) => columns.map((c) => r[c.key]))];
    downloadCsv(`${kind === 'ratings' ? `ratings-by-${group}` : kind}-report-${from}-to-${to}.csv`, '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n');
  };

  return (
    <div className="card">
      <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-end gap-4">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden" role="tablist" aria-label="Report type">
          {kinds.map((k) => (
            <button
              key={k.id}
              role="tab"
              aria-selected={kind === k.id}
              onClick={() => setKind(k.id)}
              className={`px-4 py-2 text-sm font-medium ${kind === k.id ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="rep-from" className="block text-xs font-medium text-gray-600 mb-1">From</label>
          <input id="rep-from" type="date" className="input py-1" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor="rep-to" className="block text-xs font-medium text-gray-600 mb-1">To</label>
          <input id="rep-to" type="date" className="input py-1" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
        {kind === 'rooms' && (
          <div>
            <label htmlFor="rep-block" className="block text-xs font-medium text-gray-600 mb-1">Block (optional)</label>
            <input id="rep-block" type="text" placeholder="T" maxLength={4} className="input py-1 w-24" value={block}
              onChange={(e) => setBlock(e.target.value.toUpperCase())} />
          </div>
        )}
        {kind === 'ratings' && (
          <div>
            <label htmlFor="rep-group" className="block text-xs font-medium text-gray-600 mb-1">Group by</label>
            <select id="rep-group" className="input py-1" value={group} onChange={(e) => setGroup(e.target.value as typeof group)}>
              <option value="block">Block</option>
              <option value="room">Room</option>
              <option value="cleaner">Cleaner</option>
            </select>
          </div>
        )}
        <button onClick={download} disabled={shown.length === 0} className="btn btn-outline flex items-center space-x-2 ml-auto">
          <FileDown className="h-4 w-4" />
          <span>Download CSV</span>
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center"><Loader2 className="h-8 w-8 animate-spin text-primary-600 mx-auto" /></div>
      ) : shown.length === 0 ? (
        <p className="p-8 text-center text-gray-500">No cleaning requests in these dates.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>{columns.map((c) => <th key={c.key} className="px-4 py-2 font-medium">{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((r) => (
                <tr key={String(r[first.key])}>
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-2">
                      {c.key === 'avgRating' && r.avgRating !== null ? (
                        <span className="flex items-center space-x-2"><Stars value={r.avgRating as number} /><span>{r.avgRating}</span></span>
                      ) : (
                        r[c.key] ?? '-'
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {kind === 'ratings' && comments.length > 0 && (
        <div className="border-t border-gray-100 p-6">
          <h3 className="font-medium text-gray-900 mb-3">Latest feedback</h3>
          <ul className="divide-y divide-gray-100">
            {comments.map((c, i) => (
              <li key={i} className="py-2 flex items-start space-x-3">
                <Stars value={c.rating ?? 0} />
                <p className="text-sm text-gray-700">
                  <span className="font-medium">Room {c.room}</span> cleaned by {c.cleaner}
                  {c.feedback ? `: "${c.feedback}"` : ''}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
