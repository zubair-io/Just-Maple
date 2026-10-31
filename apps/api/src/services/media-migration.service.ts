import * as Y from 'yjs';

export interface MediaCopy {
    container: string;
    name: string;
    relative: string;
    url: string;
    bytes: number;
    etag?: string;
    sha256?: string;
}

/** Only these app-owned uploads/assets are migrated; the Azure account hosts other apps. */
export function mediaDestination(container: string, name: string): string | null {
    if (name.split('/').some((s) => !s || s === '.' || s === '..') || /[\\\0]/.test(name)) {
        throw new Error('Unsafe blob name');
    }
    const folders: Record<string, string> = {
        'profile-picture': 'profile-pictures',
        recordings: 'recordings',
        'memo-images': 'memo-images',
    };
    if (folders[container]) return `${folders[container]}/${name.replaceAll('/', '-')}`;
    if (container === 'data' && name.startsWith('assets/')) return name;
    if (container === 'data' && /^lego-\d+\.json$/.test(name)) return `lego-cache/${name}`;
    return null;
}

export function mediaUrlMap(copies: MediaCopy[], azureHost: string): Map<string, string> {
    const result = new Map<string, string>();
    for (const copy of copies) {
        if (copy.relative.startsWith('lego-cache/')) continue;
        const encoded = copy.name.split('/').map(encodeURIComponent).join('/');
        for (const host of [azureHost, 'hornbeam.justmaple.app']) {
            for (const scheme of ['https:', 'http:']) {
                result.set(`${scheme}//${host}/${copy.container}/${encoded}`, copy.url);
            }
        }
    }
    return result;
}

export function rewriteMediaValue(value: unknown, urls: Map<string, string>): unknown {
    if (typeof value === 'string') {
        return value.replace(/https?:\/\/[^\s"'<>`\\)\]]+/g, (candidate) => {
            try {
                const url = new URL(candidate);
                return urls.get(url.origin + url.pathname) ?? candidate;
            } catch {
                return candidate;
            }
        });
    }
    if (Array.isArray(value)) return value.map((item) => rewriteMediaValue(item, urls));
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, rewriteMediaValue(item, urls)]),
        );
    }
    return value;
}

/** Make ordinary CRDT edits so reconnecting editors merge the new image attributes. */
export function rewriteMemoMedia(state: Uint8Array, urls: Map<string, string>): Uint8Array | null {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const fragment = doc.getXmlFragment('prosemirror');
    let changed = false;
    const visit = (parent: Y.XmlFragment | Y.XmlElement): void => {
        for (const child of parent.toArray()) {
            if (child instanceof Y.XmlElement) {
                for (const [key, value] of Object.entries(child.getAttributes())) {
                    const next = rewriteMediaValue(value, urls);
                    if (JSON.stringify(next) !== JSON.stringify(value)) {
                        child.setAttribute(key, next as string);
                        changed = true;
                    }
                }
                visit(child);
            } else if (child instanceof Y.XmlText) {
                let offset = 0;
                for (const delta of child.toDelta()) {
                    if (typeof delta.insert !== 'string') {
                        offset++;
                        continue;
                    }
                    const text = delta.insert;
                    const next = rewriteMediaValue(text, urls) as string;
                    const attrs = rewriteMediaValue(delta.attributes, urls) as
                        | Record<string, unknown>
                        | undefined;
                    if (next !== text) {
                        changed = true;
                        child.delete(offset, text.length);
                        child.insert(offset, next, attrs);
                    } else if (
                        attrs &&
                        JSON.stringify(attrs) !== JSON.stringify(delta.attributes)
                    ) {
                        changed = true;
                        child.format(offset, text.length, attrs);
                    }
                    offset += next.length;
                }
            }
        }
    };
    doc.transact(() => visit(fragment));
    const result = changed ? Y.encodeStateAsUpdate(doc) : null;
    doc.destroy();
    return result;
}
