import { Download, X } from 'lucide-react';

import type { Credential } from '../types';
import { downloadCsv } from '../utils/download';

export default function CredentialsNotice({ accounts, onClose }: { accounts: Credential[]; onClose: () => void }) {
  const save = () =>
    downloadCsv('temporary-passwords.csv', ['email,temporary password', ...accounts.map((a) => `${a.email},${a.password}`)].join('\r\n'));

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4" role="status">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium text-amber-900">Temporary passwords ({accounts.length})</h3>
          <p className="text-sm text-amber-800 mt-1">
            These are shown only once. Download the list and send each person their password. They can change it after
            signing in.
          </p>
        </div>
        <button onClick={onClose} className="text-amber-700 hover:text-amber-900" aria-label="Dismiss">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="mt-3 max-h-40 overflow-y-auto rounded-lg bg-white border border-amber-100 divide-y divide-amber-50 text-sm">
        {accounts.map((a) => (
          <div key={a.email} className="flex justify-between px-3 py-1.5">
            <span className="text-gray-700">{a.email}</span>
            <span className="font-mono text-gray-900">{a.password}</span>
          </div>
        ))}
      </div>
      <button onClick={save} className="btn btn-primary mt-3 flex items-center space-x-2">
        <Download className="h-4 w-4" />
        <span>Download passwords (CSV)</span>
      </button>
    </div>
  );
}
