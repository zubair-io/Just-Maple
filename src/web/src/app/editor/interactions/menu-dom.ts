export const interactionCSS = `
.maple-interaction{z-index:80;border:1px solid var(--color-border);border-radius:10px;background:var(--color-bg-secondary);color:var(--color-text-main);box-shadow:0 8px 28px #0002;padding:6px;font:13px/1.5 var(--font-sans);max-width:calc(100vw - 20px)}
.maple-interaction button,.maple-interaction input{font:inherit;color:inherit;background:transparent;border:0;border-radius:5px;padding:7px 10px;text-align:left}
.maple-interaction button{cursor:pointer}.maple-interaction button:disabled{opacity:.45;cursor:default}
.maple-interaction button:hover,.maple-interaction button[aria-selected=true],.maple-interaction button[aria-pressed=true]{background:var(--color-primary-light)}
.maple-interaction button:focus-visible,.maple-interaction input:focus-visible{outline:2px solid var(--color-focus);outline-offset:1px}
.maple-slash-menu{width:270px;max-height:340px;overflow:auto}.maple-slash-menu button{display:block;width:100%}.maple-menu-hint{padding:6px 10px;color:var(--color-text-muted);font-size:11px}
.maple-selection-menu{display:flex;gap:2px;align-items:center;flex-wrap:wrap;max-width:min(530px,calc(100vw - 20px))}.maple-selection-menu input{width:200px;border:1px solid var(--color-border)}
.maple-block-grip{position:fixed;z-index:75;border:0;border-radius:4px;background:var(--color-bg-secondary);color:var(--color-text-muted);cursor:grab;padding:4px 6px;font:18px var(--font-sans)}
.maple-block-drop-line{position:fixed;height:3px;background:var(--color-link);pointer-events:none;z-index:76;border-radius:2px}.maple-block-grip:focus-visible{outline:2px solid var(--color-focus)}.maple-block-actions{position:fixed;display:grid;max-height:380px;overflow:auto;min-width:210px}
`;
export function menuElement(
  doc: Document,
  className: string,
  role: string,
  label: string,
): HTMLDivElement {
  const element = doc.createElement("div");
  element.className = "maple-interaction " + className;
  element.setAttribute("role", role);
  element.setAttribute("aria-label", label);
  return element;
}
export function button(
  doc: Document,
  label: string,
  action: () => void,
): HTMLButtonElement {
  const element = doc.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("mousedown", (event) => event.preventDefault());
  element.addEventListener("click", action);
  return element;
}
export function menuKeyboard(menu: HTMLElement, onClose: () => void) {
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if ((event.target as HTMLElement).matches("input,textarea")) return;
    const buttons = Array.from(
      menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    );
    const current = buttons.indexOf(
      menu.ownerDocument.activeElement as HTMLButtonElement,
    );
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (current +
                (event.key === "ArrowDown" ? 1 : -1) +
                buttons.length) %
              buttons.length;
      buttons[next]?.focus();
    }
  });
}
