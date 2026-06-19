import {
  useId,
  useState,
  type CSSProperties,
  type FormEventHandler,
  type ReactNode,
} from 'react';

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
  type?: 'text' | 'password' | 'tel';
  inputMode?: 'text' | 'tel';
  placeholder?: string;
  className?: string;
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
}: NoSaveFieldProps) {
  const fieldId = useId();
  const [unlocked, setUnlocked] = useState(false);
  const isPassword = type === 'password';

  function unlock() {
    if (!unlocked) setUnlocked(true);
  }

  const inputType = isPassword ? (unlocked ? 'password' : 'text') : type;
  const maskedTextStyle: CSSProperties | undefined =
    isPassword && !unlocked
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
      inputMode={inputMode}
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
      onFocus={unlock}
      onPointerDown={unlock}
      onKeyDown={unlock}
      className={className}
      style={maskedTextStyle}
    />
  );

  if (!label) return input;

  return (
    <label className="block" htmlFor={fieldId}>
      <span className="mb-1 block text-sm text-[var(--color-muted)]">{label}</span>
      {input}
    </label>
  );
}
