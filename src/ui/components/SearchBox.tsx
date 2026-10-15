import { FormEvent, useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { S } from '../strings';

interface Props {
  value: string;
  onSearch: (q: string) => void;
  variant: 'hero' | 'bar';
  autoFocus?: boolean;
}

export const SEARCH_INPUT_ID = 'search-input';

export function SearchBox({ value, onSearch, variant, autoFocus }: Props) {
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);

  // Keep the box in sync when the route changes (Back button, example chips).
  useEffect(() => setText(value), [value]);

  useEffect(() => {
    if (autoFocus && input.current) input.current.focus();
  }, [autoFocus]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (q) {
      onSearch(q);
      if (input.current && variant === 'bar') input.current.blur();
    } else if (input.current) {
      input.current.focus();
    }
  };

  return (
    <form className={'searchbox searchbox--' + variant} role="search" onSubmit={submit}>
      <label htmlFor={SEARCH_INPUT_ID} className="visually-hidden">
        {S.search.label}
      </label>
      <Search className="searchbox__icon" aria-hidden="true" size={variant === 'hero' ? 24 : 20} />
      <input
        id={SEARCH_INPUT_ID}
        ref={input}
        className="searchbox__input"
        type="search"
        inputMode="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        placeholder={variant === 'hero' ? S.search.heroPlaceholder : S.search.placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {text ? (
        <button
          type="button"
          className="searchbox__clear"
          aria-label={S.search.clear}
          title={S.search.clear}
          onClick={() => {
            setText('');
            if (input.current) input.current.focus();
          }}
        >
          <X size={20} aria-hidden="true" />
        </button>
      ) : null}
      <button type="submit" className="btn btn--primary searchbox__submit">
        {S.search.submit}
      </button>
    </form>
  );
}
