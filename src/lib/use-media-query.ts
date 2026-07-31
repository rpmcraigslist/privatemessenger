import { useEffect, useState } from 'react';

/** Tracks a CSS media query (defaults to `true` before mount — desktop-first). */
export function useMediaQuery(query: string, defaultMatches = true): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return defaultMatches;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
