import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab / Shift+Tab inside `ref` while `active`, moves focus in on open (preferring an element with
 * data-autofocus) and returns focus to whatever had it before when it closes.
 */
export function useFocusTrap(ref: RefObject<HTMLElement>, active: boolean): void {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => !el.hasAttribute('data-focus-skip'));

    (root.querySelector<HTMLElement>('[data-autofocus]') ?? items()[0] ?? root).focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = items();
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0];
      const last = list[list.length - 1];
      const current = document.activeElement;
      if (!root.contains(current)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && current === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && current === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Give focus back to where it was, but only if nothing has taken it since. A command run from the
      // palette may have deliberately moved focus (e.g. into the chat box) while the dialog animated out.
      const current = document.activeElement;
      const focusIsLost = !current || current === document.body || root.contains(current);
      if (focusIsLost) previous?.focus?.({ preventScroll: true });
    };
  }, [active, ref]);
}
