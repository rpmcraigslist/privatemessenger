import { useEffect, useState } from 'react';

/** Space covered by the on-screen keyboard or browser chrome (e.g. Google credential bar). */
export function visualViewportBottomInset(
  layoutHeight: number,
  viewportHeight: number,
  viewportOffsetTop: number,
): number {
  return Math.max(0, layoutHeight - viewportHeight - viewportOffsetTop);
}

export function scrollElementIntoComfortableView(element: HTMLElement): void {
  element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
}

/** Tracks how much of the layout viewport is obscured from the bottom on mobile browsers. */
export function useVisualViewportBottomInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      setInset(
        visualViewportBottomInset(
          window.innerHeight,
          viewport.height,
          viewport.offsetTop,
        ),
      );
    };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('orientationchange', update);

    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return inset;
}
