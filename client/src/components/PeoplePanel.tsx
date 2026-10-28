import { useState } from 'react';
import toast from 'react-hot-toast';
import { Upload, FileDown, UserPlus, Loader2 } from 'lucide-react';
import { userService, getErrorMessage } from '../services/api';
import { downloadStudentTemplate } from '../utils/template';
import { readSheet } from 'read-excel-file/browser';
import type { Credential, ImportResult } from '../types';

interface Props {
  onChanged: () => void;
  onCredentials: (accounts: Credential[]) => void;
}

export default function PeoplePanel({ onChanged, onCredentials }: Props) {
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [importing, setImporting] = useState(false);
  const [removeMissing, setRemoveMissing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const [person, setPerson] = useState({ email: '', name: '', role: 'RESIDENT' as 'RESIDENT' | 'CLEANER', room: '', regNo: '' });
  const [adding, setAdding] = useState(false);

  const handleFile = async (file: File | undefined) => {
    setResult(null);
    if (!file) return;
    setFileName(file.name);
    if (/\.xlsx$/i.test(file.name)) {
      // Excel sheets are turned into the same text the server already reads
      try {
        const sheet = await readSheet(file);
        setCsv(sheet.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'));
      } catch {
        setCsv('');
        toast.error('Could not read this Excel file. Save it as .xlsx or .csv and try again.');
      }
      return;
    }
    setCsv(await file.text());
  };

  const runImport = async () => {
    if (
      removeMissing &&
      !confirm(
        'Every student who is NOT in this file will be deleted for good, with their account and details. ' +
          'Make sure the file lists all the students who stay. Continue?'
      )
    ) {
      return;
    }
    setImporting(true);
    try {
      const res = await userService.importCsv(csv, removeMissing);
      setResult(res);
      if (res.newAccounts.length) onCredentials(res.newAccounts);
      onChanged();
      if (res.summary.failed === 0) {
        toast.success(
          [res.emailed ? `${res.emailed} password email(s) sent` : '', res.removed ? `${res.removed} student(s) removed` : '']
            .filter(Boolean)
            .join(', ') || 'Done'
        );
      }
      else toast.error(`${res.summary.failed} row(s) need attention`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Import failed'));
    } finally {
      setImporting(false);
    }
  };

  const addPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      const res = await userService.create({
        email: person.email,
        name: person.name || undefined,
        role: person.role,
        room: person.role === 'RESIDENT' && person.room ? person.room : undefined,
        regNo: person.role === 'RESIDENT' && person.regNo ? person.regNo : undefined,
      });
      if (res.tempPassword) onCredentials([{ email: res.user.email, password: res.tempPassword }]);
      setPerson({ email: '', name: '', role: 'RESIDENT', room: '', regNo: '' });
      onChanged();
      toast.success(res.emailed ? 'Person added. Their password was emailed' : 'Person added');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not add this person'));
    } finally {
      setAdding(false);
    }
  };

  const summary = result?.summary;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card p-6 space-y-4" aria-labelledby="import-heading">
        <div>
          <h2 id="import-heading" className="text-lg font-semibold text-gray-900">Add many students from a file</h2>
          <p className="text-sm text-gray-600 mt-1">
            Upload an Excel or CSV sheet with the columns <strong>reg.no</strong>, <strong>name</strong>, <strong>room</strong>{' '}
            (for example <span className="font-mono">T-230</span>), <strong>room size</strong> (most people the room holds) and{' '}
            <strong>email</strong>. Rooms that do not exist are created. New students are emailed their password. Anyone already
            added only has their room changed: no new password, no email.
          </p>
        </div>

        <button
          type="button"
          onClick={() => downloadStudentTemplate()}
          className="text-sm text-primary-600 hover:text-primary-700 flex items-center space-x-1"
        >
          <FileDown className="h-4 w-4" />
          <span>Download the Excel template</span>
        </button>

        <div>
          <label htmlFor="csv-file" className="block text-sm font-medium text-gray-700 mb-1">Excel or CSV file</label>
          <input
            id="csv-file"
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => handleFile(e.target.files?.[0])}
            className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium"
          />
        </div>

        <label className="flex items-start space-x-2 text-sm text-gray-700">
          <input type="checkbox" checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} className="mt-0.5" />
          <span>Remove students who are not in this file (they have left; their account and details are deleted)</span>
        </label>

        <button
          type="button"
          onClick={runImport}
          disabled={!csv || importing}
          className="btn btn-primary flex items-center space-x-2"
        >
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          <span>{importing ? 'Adding...' : fileName ? `Add people from ${fileName}` : 'Add people'}</span>
        </button>

        {summary && (
          <div className="rounded-lg border border-gray-200 p-4 text-sm space-y-2" aria-live="polite">
            <p className="font-medium text-gray-900">
              {summary.created} added, {summary.assigned + summary.moved} moved to a room, {summary.unchanged} already
              correct, {summary.failed} need attention
            </p>
            {result && result.removed > 0 && <p className="text-gray-700">{result.removed} student(s) not in the file were removed.</p>}
            {result?.removalSkipped && <p className="text-red-700">{result.removalSkipped}</p>}
            {result && result.mailEnabled && (
              <p className="text-gray-700">
                {result.emailed} password email(s) sent{result.newAccounts.length ? `; ${result.newAccounts.length} could not be emailed, so their passwords are shown above` : ''}.
              </p>
            )}
            {result && result.failures.length > 0 && (
              <ul className="max-h-48 overflow-y-auto divide-y divide-gray-100">
                {result.failures.map((f) => (
                  <li key={f.row} className="py-1.5 text-red-700">
                    <span className="font-medium">Row {f.row}</span>
                    {f.email ? ` (${f.email})` : ''}: {f.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="card p-6" aria-labelledby="add-heading">
        <h2 id="add-heading" className="text-lg font-semibold text-gray-900">Add one person</h2>
        <p className="text-sm text-gray-600 mt-1">For a single student, or for cleaning staff.</p>
        <form onSubmit={addPerson} className="mt-4 space-y-3">
          <div>
            <label htmlFor="p-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input id="p-email" type="email" required className="input" value={person.email}
              onChange={(e) => setPerson((p) => ({ ...p, email: e.target.value }))} />
          </div>
          <div>
            <label htmlFor="p-reg" className="block text-sm font-medium text-gray-700 mb-1">Reg. no (students)</label>
            <input id="p-reg" type="text" className="input" disabled={person.role === 'CLEANER'} value={person.regNo}
              onChange={(e) => setPerson((p) => ({ ...p, regNo: e.target.value }))} />
          </div>
          <div>
            <label htmlFor="p-name" className="block text-sm font-medium text-gray-700 mb-1">Name (optional)</label>
            <input id="p-name" type="text" className="input" value={person.name}
              onChange={(e) => setPerson((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="p-role" className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select id="p-role" className="input" value={person.role}
                onChange={(e) => setPerson((p) => ({ ...p, role: e.target.value as 'RESIDENT' | 'CLEANER' }))}>
                <option value="RESIDENT">Student</option>
                <option value="CLEANER">Cleaner</option>
              </select>
            </div>
            <div>
              <label htmlFor="p-room" className="block text-sm font-medium text-gray-700 mb-1">Room</label>
              <input id="p-room" type="text" placeholder="T-230" disabled={person.role === 'CLEANER'} className="input"
                value={person.room} onChange={(e) => setPerson((p) => ({ ...p, room: e.target.value }))} />
            </div>
          </div>
          <button type="submit" disabled={adding} className="btn btn-primary flex items-center space-x-2">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            <span>{adding ? 'Adding...' : 'Add person'}</span>
          </button>
        </form>
      </section>
    </div>
  );
}
