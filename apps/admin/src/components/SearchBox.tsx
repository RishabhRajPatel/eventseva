'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { debounce, SEARCH_DEBOUNCE_MS, type Debounced } from '@/lib/debounce';

/**
 * Search field that applies 300 ms after typing stops (Enter applies at once). The value in the URL
 * is the source of truth: when it changes elsewhere (Back, "Clear filters"), the field follows.
 */
export function SearchBox({
  initial,
  onSearch,
  placeholder,
  label = 'Search',
  maxLength = 40,
  mono = false,
}: {
  initial: string;
  /** `typing` is true for the debounced call, false for Enter / the button / clearing. */
  onSearch: (value: string, typing: boolean) => void;
  placeholder: string;
  label?: string;
  maxLength?: number;
  mono?: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  // What this box last sent, to tell its own URL updates apart from outside changes.
  const [sent, setSent] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    if (initial !== sent) {
      setValue(initial);
      setSent(initial);
    }
  }

  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
  });

  // Created on first use (in an event handler), cancelled on unmount.
  const pending = useRef<Debounced<[string, boolean]> | null>(null);
  useEffect(() => () => pending.current?.cancel(), []);

  function change(raw: string) {
    setValue(raw);
    const next = raw.trim();
    pending.current ??= debounce((q: string, typing: boolean) => {
      setSent(q);
      onSearchRef.current(q, typing);
    }, SEARCH_DEBOUNCE_MS);
    if (next === sent) pending.current.cancel();
    else pending.current(next, true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = value.trim();
    pending.current?.cancel();
    if (next !== sent) {
      setSent(next);
      onSearch(next, false);
    }
  }

  return (
    <form className="field grow" role="search" onSubmit={submit}>
      <label htmlFor={id}>{label}</label>
      <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
        <input
          id={id}
          type="search"
          className={`input${mono ? ' mono' : ''}`}
          placeholder={placeholder}
          value={value}
          maxLength={maxLength}
          onChange={(e) => change(e.target.value)}
          data-active={sent ? 'true' : undefined}
          autoComplete="off"
        />
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </div>
    </form>
  );
}
