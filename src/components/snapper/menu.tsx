import { useEffect, useRef, type ReactNode } from "react";

/** A native disclosure with the dismissal behavior expected of an action menu. */
export function Menu({
  children,
  trigger,
  label,
  className,
  triggerClassName,
}: {
  children: ReactNode;
  trigger: ReactNode;
  label?: string;
  className: string;
  triggerClassName?: string;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const node = menu.current;
    if (!node) return;
    const pointer = (event: PointerEvent) => {
      if (node.open && !event.composedPath().includes(node)) node.open = false;
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !node.open) return;
      event.preventDefault();
      event.stopPropagation();
      node.open = false;
      node.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", key, true);
    };
  }, []);
  return (
    <details
      ref={menu}
      className={className}
      data-action-menu
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}
      onClickCapture={(event) => {
        const button = event.target instanceof Element ? event.target.closest("button") : null;
        if (button && !button.disabled) {
          // Capture the visible trigger before an action opens a confirmation,
          // including browsers that do not focus buttons on pointer clicks.
          event.currentTarget.querySelector("summary")?.focus({ preventScroll: true });
        }
      }}
      onClick={(event) => {
        const button = event.target instanceof Element ? event.target.closest("button") : null;
        if (button && !button.disabled) event.currentTarget.open = false;
      }}
    >
      <summary aria-label={label} className={triggerClassName}>
        {trigger}
      </summary>
      <div>{children}</div>
    </details>
  );
}
