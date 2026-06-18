import { colorForKey, initials } from '../lib/util';

type Props = {
  label: string;
  size?: number;
  colorKey?: string;
};

export default function Avatar({ label, size = 44, colorKey }: Props) {
  const bg = colorForKey(colorKey ?? label);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none"
      style={{
        width: size,
        height: size,
        backgroundColor: bg,
        fontSize: size * 0.4,
      }}
      aria-hidden
    >
      {initials(label)}
    </div>
  );
}
