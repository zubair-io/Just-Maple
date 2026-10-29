// Safari < 17.4 and some WKWebView versions ship ReadableStream without
// Symbol.asyncIterator. phonemizer (a kokoro-js dep) uses
// `for await (chunk of stream)` to decode its bundled gzip dictionary at
// module-init time, which crashes there with:
//   TypeError: undefined is not a function (near '...A of e...')
//
// This polyfill MUST run before any module that statically imports kokoro-js.
// Import it as the very first side-effect in main.ts.

if (typeof ReadableStream !== 'undefined') {
  const proto = ReadableStream.prototype as unknown as Record<symbol, unknown>;
  if (!proto[Symbol.asyncIterator]) {
    proto[Symbol.asyncIterator] = function (this: ReadableStream) {
      const reader = this.getReader();
      return {
        next: () => reader.read(),
        return: () => {
          reader.releaseLock();
          return Promise.resolve({ value: undefined, done: true });
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    };
  }
}
