import { Star } from 'lucide-react';

// Read-only when no onChange is given
export default function Stars({ value, onChange }: { value: number; onChange?: (rating: number) => void }) {
  return (
    <div className="flex items-center" role={onChange ? 'radiogroup' : 'img'} aria-label={`Rating: ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const icon = <Star className={`h-5 w-5 ${n <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />;
        return onChange ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === value}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            onClick={() => onChange(n)}
            className="p-0.5"
          >
            {icon}
          </button>
        ) : (
          <span key={n}>{icon}</span>
        );
      })}
    </div>
  );
}
