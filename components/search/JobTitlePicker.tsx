'use client';

import { useState } from 'react';
import { Button, cx } from '@/components/ui';
import { JOB_TITLE_PRESETS } from '@/lib/constants/search';

export function JobTitlePicker({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [custom, setCustom] = useState('');

  function toggle(title: string) {
    onChange(value.includes(title) ? value.filter((t) => t !== title) : [...value, title]);
  }

  function addCustom() {
    const title = custom.trim();
    if (!title) return;
    if (!value.some((t) => t.toLowerCase() === title.toLowerCase())) {
      onChange([...value, title]);
    }
    setCustom('');
  }

  const customTitles = value.filter(
    (t) => !JOB_TITLE_PRESETS.some((p) => p.toLowerCase() === t.toLowerCase()),
  );

  return (
    <div>
      <span className="field-label">Job titles</span>

      <div className="flex flex-wrap gap-2">
        {JOB_TITLE_PRESETS.map((title) => {
          const selected = value.includes(title);
          return (
            <button
              key={title}
              type="button"
              disabled={disabled}
              onClick={() => toggle(title)}
              aria-pressed={selected}
              className={cx(
                'rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors disabled:opacity-50',
                selected
                  ? 'bg-brand-600 text-white ring-brand-600'
                  : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50',
              )}
            >
              {title}
            </button>
          );
        })}

        {customTitles.map((title) => (
          <button
            key={title}
            type="button"
            disabled={disabled}
            onClick={() => toggle(title)}
            aria-pressed
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1.5 text-sm font-medium text-white ring-1 ring-inset ring-brand-600 disabled:opacity-50"
          >
            {title}
            <span aria-hidden="true">×</span>
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={custom}
          disabled={disabled}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="Add a custom title, e.g. Salgsdirektør"
          className="field-input max-w-xs"
          aria-label="Custom job title"
        />
        <Button type="button" variant="secondary" onClick={addCustom} disabled={disabled || !custom.trim()}>
          Add
        </Button>
      </div>

      <p className="field-hint">
        {value.length === 0
          ? 'Select at least one title.'
          : `${value.length} title${value.length === 1 ? '' : 's'} selected.`}
      </p>
    </div>
  );
}
