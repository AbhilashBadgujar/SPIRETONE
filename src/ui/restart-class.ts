/** Re-trigger a CSS animation class. */
export function restartClass(el: HTMLElement | undefined, cls: string): void {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
