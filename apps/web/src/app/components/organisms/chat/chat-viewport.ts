/** Keep the latest message pinned, or preserve the visible message while reading history. */
export class ChatViewport {
  private frame?: number;
  private observer?: ResizeObserver;
  private initialPending = true;
  private initialReady = false;
  private following = true;
  private anchor?: { id: string; offset: number };
  private disposed = false;

  constructor(
    private readonly viewport: HTMLElement,
    content: HTMLElement,
  ) {
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.layoutChanged());
      this.observer.observe(content);
      this.observer.observe(viewport);
    }
  }

  reset(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.initialPending = true;
    this.initialReady = false;
    this.following = true;
    this.anchor = undefined;
  }

  completeInitialLoad(): void {
    this.initialReady = true;
    this.layoutChanged();
  }

  get atBottom(): boolean {
    return this.following;
  }

  /** Returns whether this is a reader at the top, rather than an initial/programmatic scroll. */
  scrolled(): boolean {
    if (this.initialPending) return false;
    this.following =
      this.viewport.scrollHeight - this.viewport.scrollTop - this.viewport.clientHeight < 50;
    this.anchor = this.following ? undefined : this.captureAnchor();
    return !this.following && this.viewport.scrollTop < 100;
  }

  followLatest(): void {
    this.following = true;
    this.anchor = undefined;
    this.layoutChanged();
  }

  layoutChanged(): void {
    if (this.disposed || (this.initialPending && !this.initialReady)) return;
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      if (this.disposed) return;
      if (this.following) {
        this.viewport.scrollTop = this.viewport.scrollHeight;
      } else if (this.anchor) {
        const target = Array.from(
          this.viewport.querySelectorAll<HTMLElement>('[data-message-id]'),
        ).find((element) => element.dataset['messageId'] === this.anchor!.id);
        if (target) {
          const offset =
            target.getBoundingClientRect().top - this.viewport.getBoundingClientRect().top;
          this.viewport.scrollTop += offset - this.anchor.offset;
        }
      }
      this.initialPending = false;
    });
  }

  private captureAnchor(): { id: string; offset: number } | undefined {
    const top = this.viewport.getBoundingClientRect().top;
    for (const element of this.viewport.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom > top) return { id: element.dataset['messageId']!, offset: rect.top - top };
    }
    return undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.observer?.disconnect();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
  }
}
