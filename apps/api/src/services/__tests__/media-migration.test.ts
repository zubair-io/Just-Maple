import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
    mediaDestination,
    mediaUrlMap,
    rewriteMediaValue,
    rewriteMemoMedia,
} from '../media-migration.service';

const oldUrl = 'https://hornbeam.blob.core.windows.net/memo-images/user/page/photo.jpg';
const local = '/api/storage/memo-images/user-page-photo.jpg';
const urls = mediaUrlMap(
    [
        {
            container: 'memo-images',
            name: 'user/page/photo.jpg',
            relative: 'memo-images/user-page-photo.jpg',
            url: local,
            bytes: 12,
        },
    ],
    'hornbeam.blob.core.windows.net',
);

describe('media migration', () => {
    it('limits copying to app-owned containers/assets and matches local upload paths', () => {
        expect(mediaDestination('recordings', 'user/clip.webm')).toBe('recordings/user-clip.webm');
        expect(mediaDestination('profile-picture', 'avatar.jpg')).toBe(
            'profile-pictures/avatar.jpg',
        );
        expect(mediaDestination('data', 'assets/icons/leaf.png')).toBe('assets/icons/leaf.png');
        expect(mediaDestination('data', 'lego-123.json')).toBe('lego-cache/lego-123.json');
        expect(mediaDestination('seadragon', 'photo.jpg')).toBeNull();
        expect(mediaDestination('data', 'another-app/file.json')).toBeNull();
        expect(() => mediaDestination('recordings', '../secret')).toThrow();
    });

    it('rewrites only verified exact media URLs, including aliases and nested attributes', () => {
        expect(
            rewriteMediaValue(
                {
                    src: oldUrl,
                    nested: [
                        oldUrl.replace('hornbeam.blob.core.windows.net', 'hornbeam.justmaple.app') +
                            '?sv=legacy',
                    ],
                },
                urls,
            ),
        ).toEqual({ src: local, nested: [local] });
        expect(rewriteMediaValue(oldUrl + '.unrelated', urls)).toBe(oldUrl + '.unrelated');
        expect(
            rewriteMediaValue('https://other.example/memo-images/user/page/photo.jpg', urls),
        ).toBe('https://other.example/memo-images/user/page/photo.jpg');
    });

    it('updates image attributes and link text through mergeable Yjs edits, retaining other content', () => {
        const source = new Y.Doc();
        const root = source.getXmlFragment('prosemirror');
        const image = new Y.XmlElement('image');
        image.setAttribute('src', oldUrl);
        image.setAttribute('alt', 'Keep this caption');
        image.setAttribute('urls', { original: oldUrl } as unknown as string);
        const p = new Y.XmlElement('paragraph');
        const text = new Y.XmlText();
        p.insert(0, [text]);
        root.insert(0, [image, p]);
        text.insert(0, oldUrl, { link: { href: oldUrl }, bold: true });
        const state = Y.encodeStateAsUpdate(source);
        const next = rewriteMemoMedia(state, urls)!;
        expect(next).not.toBeNull();
        Y.applyUpdate(source, next);
        expect(image.getAttribute('src')).toBe(local);
        expect(image.getAttribute('alt')).toBe('Keep this caption');
        expect(image.getAttribute('urls')).toEqual({ original: local });
        expect(text.toDelta()[0].insert).toBe(local);
        expect(text.toDelta()[0].attributes).toEqual({ link: { href: local }, bold: true });
        expect(rewriteMemoMedia(Y.encodeStateAsUpdate(source), urls)).toBeNull();
        source.destroy();
    });
});
