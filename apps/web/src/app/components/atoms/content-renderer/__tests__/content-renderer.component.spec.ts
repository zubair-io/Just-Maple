import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ContentRendererComponent } from '../content-renderer.component';
import type { NoteContent } from '@maple/shared';

describe('ContentRendererComponent', () => {
    let component: ContentRendererComponent;
    let fixture: ComponentFixture<ContentRendererComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ContentRendererComponent],
        }).compileComponents();

        fixture = TestBed.createComponent(ContentRendererComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        fixture.destroy();
    });

    describe('initialization', () => {
        it('should create component', () => {
            expect(component).toBeTruthy();
        });

        it('should render empty when no content is provided', () => {
            fixture.detectChanges();

            const contentRenderer = fixture.nativeElement.querySelector('.content-renderer');
            expect(contentRenderer).not.toBeNull();
        });
    });

    describe('content rendering', () => {
        it('should render paragraph content', async () => {
            const content: NoteContent = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Hello World' }],
                    },
                ],
            };

            fixture.componentRef.setInput('content', content);
            fixture.detectChanges();
            await fixture.whenStable();

            const tiptap = fixture.nativeElement.querySelector('.tiptap');
            expect(tiptap).not.toBeNull();
            expect(tiptap.textContent).toContain('Hello World');
        });

        it('should render heading content', async () => {
            const content: NoteContent = {
                type: 'doc',
                content: [
                    {
                        type: 'heading',
                        attrs: { level: 1 },
                        content: [{ type: 'text', text: 'My Heading' }],
                    },
                ],
            };

            fixture.componentRef.setInput('content', content);
            fixture.detectChanges();
            await fixture.whenStable();

            const heading = fixture.nativeElement.querySelector('h1');
            expect(heading).not.toBeNull();
            expect(heading.textContent).toContain('My Heading');
        });

        it('should render bullet list content', async () => {
            const content: NoteContent = {
                type: 'doc',
                content: [
                    {
                        type: 'bulletList',
                        content: [
                            {
                                type: 'listItem',
                                content: [
                                    {
                                        type: 'paragraph',
                                        content: [{ type: 'text', text: 'Item 1' }],
                                    },
                                ],
                            },
                            {
                                type: 'listItem',
                                content: [
                                    {
                                        type: 'paragraph',
                                        content: [{ type: 'text', text: 'Item 2' }],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            };

            fixture.componentRef.setInput('content', content);
            fixture.detectChanges();
            await fixture.whenStable();

            const list = fixture.nativeElement.querySelector('ul');
            expect(list).not.toBeNull();
            const items = fixture.nativeElement.querySelectorAll('li');
            expect(items.length).toBe(2);
        });

        it('should render blockquote content', async () => {
            const content: NoteContent = {
                type: 'doc',
                content: [
                    {
                        type: 'blockquote',
                        content: [
                            {
                                type: 'paragraph',
                                content: [{ type: 'text', text: 'A quote' }],
                            },
                        ],
                    },
                ],
            };

            fixture.componentRef.setInput('content', content);
            fixture.detectChanges();
            await fixture.whenStable();

            const blockquote = fixture.nativeElement.querySelector('blockquote');
            expect(blockquote).not.toBeNull();
            expect(blockquote.textContent).toContain('A quote');
        });

        it('should render bold text', async () => {
            const content: NoteContent = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Bold Text',
                                marks: [{ type: 'bold' }],
                            },
                        ],
                    },
                ],
            };

            fixture.componentRef.setInput('content', content);
            fixture.detectChanges();
            await fixture.whenStable();

            const strong = fixture.nativeElement.querySelector('strong');
            expect(strong).not.toBeNull();
            expect(strong.textContent).toContain('Bold Text');
        });

        it('should render italic text', async () => {
            const content: NoteContent = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Italic Text',
                                marks: [{ type: 'italic' }],
                            },
                        ],
                    },
                ],
            };

            fixture.componentRef.setInput('content', content);
            fixture.detectChanges();
            await fixture.whenStable();

            const em = fixture.nativeElement.querySelector('em');
            expect(em).not.toBeNull();
            expect(em.textContent).toContain('Italic Text');
        });
    });

    describe('content updates', () => {
        it('should update when content changes', async () => {
            const initialContent: NoteContent = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Initial' }],
                    },
                ],
            };

            fixture.componentRef.setInput('content', initialContent);
            fixture.detectChanges();
            await fixture.whenStable();

            expect(fixture.nativeElement.textContent).toContain('Initial');

            const updatedContent: NoteContent = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Updated' }],
                    },
                ],
            };

            fixture.componentRef.setInput('content', updatedContent);
            fixture.detectChanges();
            await fixture.whenStable();

            expect(fixture.nativeElement.textContent).toContain('Updated');
        });

        it('should handle null content gracefully', async () => {
            const content: NoteContent = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Some content' }],
                    },
                ],
            };

            fixture.componentRef.setInput('content', content);
            fixture.detectChanges();
            await fixture.whenStable();

            expect(fixture.nativeElement.textContent).toContain('Some content');

            fixture.componentRef.setInput('content', null);
            fixture.detectChanges();
            await fixture.whenStable();

            // Should not throw and should clear content
            expect(fixture.nativeElement.querySelector('.content-renderer')).not.toBeNull();
        });
    });

    describe('readonly behavior', () => {
        it('should render in read-only mode', async () => {
            const content: NoteContent = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Read only content' }],
                    },
                ],
            };

            fixture.componentRef.setInput('content', content);
            fixture.detectChanges();
            await fixture.whenStable();

            const tiptap = fixture.nativeElement.querySelector('.tiptap');
            expect(tiptap).not.toBeNull();
            // Editor should not be editable
            expect(tiptap.getAttribute('contenteditable')).toBe('false');
        });
    });
});
