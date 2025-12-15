import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoteEditorComponent } from '../note-editor.component';
import type { Note, Tag, NoteContent } from '@maple/shared';

describe('NoteEditorComponent', () => {
    let component: NoteEditorComponent;
    let fixture: ComponentFixture<NoteEditorComponent>;

    const mockNote: Note = {
        _id: 'note-123',
        userId: 'user-123',
        title: 'Test Note',
        content: {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Hello World' }],
                },
            ],
        },
        version: 1,
        tagId: 'tag-123',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    const mockTag: Tag = {
        _id: 'tag-123',
        userId: 'user-123',
        type: 'folder',
        value: 'test-tag',
        label: 'Test Tag',
        color: '#ff0000',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [NoteEditorComponent],
        }).compileComponents();

        fixture = TestBed.createComponent(NoteEditorComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        fixture.destroy();
    });

    describe('initialization', () => {
        it('should create component', () => {
            expect(component).toBeTruthy();
        });

        it('should show empty state when no note is provided', () => {
            fixture.detectChanges();

            const emptyState = fixture.nativeElement.querySelector('.empty-state');
            expect(emptyState).not.toBeNull();
            expect(emptyState.textContent).toContain('Select a note');
        });

        it('should show editor when note is provided', () => {
            fixture.componentRef.setInput('note', mockNote);
            fixture.detectChanges();

            const editorContainer = fixture.nativeElement.querySelector('.editor-container');
            expect(editorContainer).not.toBeNull();
        });
    });

    describe('title handling', () => {
        beforeEach(() => {
            fixture.componentRef.setInput('note', mockNote);
            fixture.componentRef.setInput('editable', true);
            fixture.detectChanges();
        });

        it('should display note title', () => {
            const titleInput = fixture.nativeElement.querySelector('.title-input');
            expect(titleInput.value).toBe('Test Note');
        });

        it('should emit titleChange when title is modified', () => {
            const titleChangeSpy = vi.fn();
            component.titleChange.subscribe(titleChangeSpy);

            const titleInput = fixture.nativeElement.querySelector('.title-input');
            titleInput.value = 'Updated Title';
            titleInput.dispatchEvent(new Event('input'));
            fixture.detectChanges();

            expect(titleChangeSpy).toHaveBeenCalledWith('Updated Title');
        });

        it('should prevent default and not throw when pressing Enter in title', () => {
            const titleInput = fixture.nativeElement.querySelector('.title-input');

            const keydownEvent = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
            titleInput.dispatchEvent(keydownEvent);

            // Should not throw an error
            expect(keydownEvent.defaultPrevented).toBe(true);
        });
    });

    describe('readonly mode', () => {
        beforeEach(() => {
            fixture.componentRef.setInput('note', mockNote);
            fixture.componentRef.setInput('editable', false);
            fixture.detectChanges();
        });

        it('should show readonly title instead of input', () => {
            const titleInput = fixture.nativeElement.querySelector('.title-input');
            const titleReadonly = fixture.nativeElement.querySelector('.title-readonly');

            expect(titleInput).toBeNull();
            expect(titleReadonly).not.toBeNull();
            expect(titleReadonly.textContent).toContain('Test Note');
        });

        it('should not show toolbar in readonly mode', () => {
            const toolbar = fixture.nativeElement.querySelector('.toolbar');
            expect(toolbar).toBeNull();
        });

        it('should have readonly class on container', () => {
            const container = fixture.nativeElement.querySelector('.editor-container');
            expect(container.classList.contains('readonly')).toBe(true);
        });
    });

    describe('toolbar', () => {
        beforeEach(() => {
            fixture.componentRef.setInput('note', mockNote);
            fixture.componentRef.setInput('editable', true);
            fixture.detectChanges();
        });

        it('should show toolbar in editable mode', () => {
            const toolbar = fixture.nativeElement.querySelector('.toolbar');
            expect(toolbar).not.toBeNull();
        });

        it('should have formatting buttons', () => {
            const buttons = fixture.nativeElement.querySelectorAll('.toolbar button');
            expect(buttons.length).toBeGreaterThan(0);

            // Check for specific buttons
            const buttonTitles = Array.from(buttons as NodeListOf<Element>).map((btn) =>
                btn.getAttribute('title'),
            );
            expect(buttonTitles).toContain('Bold');
            expect(buttonTitles).toContain('Italic');
            expect(buttonTitles).toContain('Heading 1');
        });

        it('should call toggleBold when bold button is clicked', () => {
            const toggleBoldSpy = vi.spyOn(component, 'toggleBold');
            const boldButton = fixture.nativeElement.querySelector('button[title="Bold"]');

            boldButton.click();
            fixture.detectChanges();

            expect(toggleBoldSpy).toHaveBeenCalled();
        });

        it('should call toggleItalic when italic button is clicked', () => {
            const toggleItalicSpy = vi.spyOn(component, 'toggleItalic');
            const italicButton = fixture.nativeElement.querySelector('button[title="Italic"]');

            italicButton.click();
            fixture.detectChanges();

            expect(toggleItalicSpy).toHaveBeenCalled();
        });
    });

    describe('tag display', () => {
        it('should show tag when provided', () => {
            fixture.componentRef.setInput('note', mockNote);
            fixture.componentRef.setInput('tag', mockTag);
            fixture.detectChanges();

            const tagElement = fixture.nativeElement.querySelector('.tag');
            expect(tagElement).not.toBeNull();
            expect(tagElement.textContent).toContain('Test Tag');
        });

        it('should not show tags section when no tag is provided', () => {
            fixture.componentRef.setInput('note', mockNote);
            fixture.componentRef.setInput('tag', null);
            fixture.detectChanges();

            const tagsSection = fixture.nativeElement.querySelector('.tags');
            expect(tagsSection).toBeNull();
        });
    });

    describe('content updates', () => {
        beforeEach(() => {
            fixture.componentRef.setInput('note', mockNote);
            fixture.componentRef.setInput('editable', true);
            fixture.detectChanges();
        });

        it('should update content when note changes', async () => {
            const updatedNote: Note = {
                ...mockNote,
                _id: 'note-456',
                title: 'New Note',
                content: {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [{ type: 'text', text: 'New content' }],
                        },
                    ],
                },
            };

            fixture.componentRef.setInput('note', updatedNote);
            fixture.detectChanges();
            await fixture.whenStable();

            expect(component.title()).toBe('New Note');
        });
    });

    describe('public methods', () => {
        beforeEach(() => {
            fixture.componentRef.setInput('note', mockNote);
            fixture.componentRef.setInput('editable', true);
            fixture.detectChanges();
        });

        it('should have focusTitle method', () => {
            expect(component.focusTitle).toBeDefined();
            expect(() => component.focusTitle()).not.toThrow();
        });

        it('should have focusEditor method', () => {
            expect(component.focusEditor).toBeDefined();
            expect(() => component.focusEditor()).not.toThrow();
        });

        it('should have isActive method', () => {
            expect(component.isActive).toBeDefined();
            expect(typeof component.isActive('bold')).toBe('boolean');
        });
    });
});
