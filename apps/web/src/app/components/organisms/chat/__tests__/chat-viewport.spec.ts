import { ChatViewport } from '../chat-viewport';

describe('chat viewport', () => {
  let callbacks: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let resize: () => void;
  beforeEach(() => {
    callbacks = new Map();
    nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());
  function fixture() {
    const viewport = document.createElement('div');
    const content = document.createElement('div');
    viewport.append(content);
    let height = 1000;
    let scroll = 0;
    const tops = Array.from({ length: 10 }, (_, i) => i * 100);
    Object.defineProperties(viewport, {
      clientHeight: { get: () => 200 },
      scrollHeight: { get: () => height },
      scrollTop: {
        get: () => scroll,
        set: (value) => {
          scroll = Math.max(0, Math.min(height - 200, value));
        },
      },
    });
    viewport.getBoundingClientRect = () => new DOMRect(0, 0, 400, 200);
    for (let i = 0; i < 10; i++) {
      const message = document.createElement('div');
      message.dataset['messageId'] = `message-${i}`;
      message.getBoundingClientRect = () => new DOMRect(0, tops[i] - scroll, 400, 100);
      content.append(message);
    }
    const controller = new ChatViewport(viewport, content);
    return {
      viewport,
      controller,
      tops,
      setHeight: (value: number) => {
        height = value;
      },
    };
  }
  function render() {
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach((callback) => callback(0));
  }
  it('positions the initial page at the bottom and follows late card/image growth', () => {
    const f = fixture();
    expect(f.controller.scrolled()).toBe(false);
    f.controller.completeInitialLoad();
    render();
    expect(f.viewport.scrollTop).toBe(800);
    f.setHeight(1400);
    resize();
    render();
    expect(f.viewport.scrollTop).toBe(1200);
    f.controller.dispose();
  });
  it('holds the same visible message when older history is prepended and new replies arrive', () => {
    const f = fixture();
    f.controller.completeInitialLoad();
    render();
    f.viewport.scrollTop = 300;
    f.controller.scrolled();
    for (let i = 0; i < f.tops.length; i++) f.tops[i] += 200;
    f.setHeight(1400); // 200 above and 200 below the reader.
    resize();
    render();
    expect(f.viewport.scrollTop).toBe(500);
    expect(f.controller.atBottom).toBe(false);
    f.controller.dispose();
  });
  it('honors scrolling up even if an automatic bottom adjustment was already scheduled', () => {
    const f = fixture();
    f.controller.completeInitialLoad();
    render();
    f.controller.layoutChanged();
    f.viewport.scrollTop = 80;
    expect(f.controller.scrolled()).toBe(true);
    render();
    expect(f.viewport.scrollTop).toBe(80);
    f.controller.followLatest();
    render();
    expect(f.viewport.scrollTop).toBe(800);
    f.controller.dispose();
  });
  it('cancels old scroll work when switching chats or disposing the view', () => {
    const f = fixture();
    f.controller.completeInitialLoad();
    f.controller.reset();
    render();
    expect(f.viewport.scrollTop).toBe(0);
    f.setHeight(600);
    f.controller.completeInitialLoad();
    render();
    expect(f.viewport.scrollTop).toBe(400);
    f.controller.followLatest();
    f.controller.dispose();
    f.setHeight(1000);
    resize();
    render();
    expect(f.viewport.scrollTop).toBe(400);
  });
});
