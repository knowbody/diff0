/** Try the browser clipboard, then the legacy selection path. Always remove the temporary field. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    const focused = document.activeElement;
    field.value = text;
    field.style.position = "fixed";
    field.style.opacity = "0";
    field.setAttribute("aria-hidden", "true");
    try {
      document.body.appendChild(field);
      field.select();
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      field.remove();
      if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    }
  }
}
