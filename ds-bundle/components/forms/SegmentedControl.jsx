import React from 'react';

/* Segmented control berkotak — pilihan biner/terner yang mengubah mode,
   bukan filter (Dine In / Takeaway). Berbeda dari Chip: tidak memakai
   aksen, tetap netral, karena ini bukan aksi utama layar. */
export function SegmentedControl({ options, value, onChange, ariaLabel }) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const val = typeof opt === 'string' ? opt : opt.value;
        const lbl = typeof opt === 'string' ? opt : opt.label;
        return (
          <button
            key={val}
            type="button"
            aria-pressed={value === val}
            onClick={() => onChange?.(val)}
          >
            {lbl}
          </button>
        );
      })}
    </div>
  );
}
