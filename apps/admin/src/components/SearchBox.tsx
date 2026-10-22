'use client';
import { useState, type FormEvent } from 'react';

/** Search field that applies on Enter or the button, so each keystroke does not hit the API. */
export function SearchBox({
  initial,
  onSearch,
  placeholder,
  label = 'Search',
}: {
  initial: string;
  onSearch: (value: string) => void;
  placeholder: string;
  label?: string;
}) {
  const [value, setValue] = useState(initial);
  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch(value.trim());
  }
  return (
    <form className="field grow" role="search" onSubmit={submit}>
      <label htmlFor="q">{label}</label>
      <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
        <input
          id="q"
          type="search"
          className="input"
          placeholder={placeholder}
          value={value}
          maxLength={40}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </div>
    </form>
  );
}
