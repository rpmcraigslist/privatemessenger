import {
  useId,
  useState,
  type CSSProperties,
  type FocusEventHandler,
  type FormEventHandler,
  type ReactNode,
} from 'react';

import { scrollElementIntoComfortableView } from '../lib/visual-viewport';

const DECOY_CLASS =
  'pointer-events-none absolute left-[-9999px] top-0 h-px w-px overflow-hidden opacity-0';

/** Wrap credential forms so browsers and password managers skip save/autofill prompts. */
export function NoSaveForm({
  children,
  onSubmit,
  className,
}: {
  children: ReactNode;
  onSubmit: FormEventHandler<HTMLFormElement>;
  className?: string;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className={className}
      autoComplete="off"
      data-no-save-password="true"
    >
      <input
        type="text"
        name="username"
        autoComplete="username"
        tabIndex={-1}
        aria-hidden="true"
        defaultValue=""
        className={DECOY_CLASS}
        readOnly
      />
      <input
        type="password"
        name="password"
        autoComplete="current-password"
        tabIndex={-1}
        aria-hidden="true"
        defaultValue=""
        className={DECOY_CLASS}
        readOnly
      />
      {children}
    </form>
  );
}

type NoSaveFieldProps = {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password' | 'tel' | 'email';
  inputMode?: 'text' | 'tel' | 'email';
  placeholder?: string;
  className?: string;
  showPasswordToggle?: boolean;
  /** Keep focused field visible when mobile keyboards or credential bars resize the viewport. */
  keepInViewOnFocus?: boolean;
};

/** Input that resists autofill and "save password?" prompts across major browsers. */
export function NoSaveField({
  label,
  value,
  onChange,
  type = 'text',
  inputMode,
  placeholder,
  className = 'w-full rounded-lg bg-[var(--color-panel-2)] px-3 py-2.5 outline-none',
  showPasswordToggle = false,
  keepInViewOnFocus = false,
}: NoSaveFieldProps) {
  const fieldId = useId();
  const [unlocked, setUnlocked] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const isEmail = type === 'email';

  function unlock() {
    if (!unlocked) setUnlocked(true);
  }

  const handleFocus: FocusEventHandler<HTMLInputElement> = (event) => {
    unlock();
    if (!keepInViewOnFocus) return;
    const target = event.currentTarget;
    requestAnimationFrame(() => scrollElementIntoComfortableView(target));
    window.setTimeout(() => scrollElementIntoComfortableView(target), 120);
  };

  const inputType = isPassword
    ? !unlocked
      ? 'text'
      : showPassword
        ? 'text'
        : 'password'
    : isEmail
      ? 'text'
      : type;
  const resolvedInputMode = inputMode ?? (isEmail ? 'email' : undefined);
  const maskedTextStyle: CSSProperties | undefined =
    isPassword && !unlocked && !showPassword
      ? ({ WebkitTextSecurity: 'disc' } as CSSProperties)
      : undefined;

  const input = (
    <input
      id={fieldId}
      type={inputType}
      name={`messenger-field-${fieldId.replace(/:/g, '')}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={resolvedInputMode}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      aria-autocomplete="none"
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      data-dashlane-ignore="true"
      data-kwimpalastatus="dead"
      data-form-type="other"
      readOnly={!unlocked}
      onFocus={handleFocus}
      onPointerDown={unlock}
      onKeyDown={unlock}
      className={className}
      style={maskedTextStyle}
    />
  );

  if (!label) return input;

  return (
    <div className="block">
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="text-sm text-[var(--color-muted)]" htmlFor={fieldId}>
          {label}
        </label>
        {isPassword && showPasswordToggle && (
          <label
            className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-muted)]"
            htmlFor={`${fieldId}-show-password`}
          >
            <input
              id={`${fieldId}-show-password`}
              type="checkbox"
              checked={showPassword}
              onChange={(e) => {
                const visible = e.target.checked;
                setShowPassword(visible);
                if (visible) setUnlocked(true);
              }}
              className="rounded"
            />
            Show password
          </label>
        )}
      </div>
      {input}
    </div>
  );
}
