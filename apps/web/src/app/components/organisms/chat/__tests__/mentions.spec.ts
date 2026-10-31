import { TestBed } from '@angular/core/testing';
import { signal, type Type } from '@angular/core';
import { BehaviorSubject, EMPTY, of } from 'rxjs';
import type { Editor } from '@tiptap/core';
import { extractMentions, type Message } from '@maple/shared';
import { ChatComponent } from '../chat.component';
import { ThreadPanelComponent } from '../thread-panel/thread-panel.component';
import { MentionSuggestionComponent } from '../mention-suggestion.component';
import { BotService, type BotSuggestion } from '../../../../services/bot.service';
import { MessageService } from '../../../../services/message.service';
import { RealtimeService } from '../../../../services/realtime.service';
import { AuthService } from '../../../../services/auth.service';
import { UiStateService } from '../../../../services/ui-state.service';
import { BotActivityService } from '../../../../services/bot-activity.service';

const bots: BotSuggestion[] = ['maple', 'cedar'].map((handle) => ({
  id: handle,
  handle,
  displayName: handle,
  type: 'bot',
  ownerId: 'me',
  ownerName: 'Me',
}));
for (const thread of [false, true])
  describe(`${thread ? 'thread' : 'main chat'} mentions`, () => {
    const lookups = new BehaviorSubject<BotSuggestion[]>(bots);
    const send = vi.fn(() => of(undefined));
    async function setup(initial = bots) {
      lookups.next(initial);
      const componentType = (thread ? ThreadPanelComponent : ChatComponent) as Type<
        ChatComponent | ThreadPanelComponent
      >;
      TestBed.configureTestingModule({
        imports: [componentType],
        providers: [
          {
            provide: BotService,
            useValue: {
              notebookBotsCacheVersion: signal(0),
              getNotebookBots: () => lookups,
              getThreadForMessage: () => of({ thread: null, messages: [] }),
            },
          },
          {
            provide: MessageService,
            useValue: {
              messagesForTag: signal([]),
              isLoading: signal(false),
              hasMore: signal(false),
              historyError: signal(null),
              loadMessages: () => of(undefined),
              loadMessagesByPageId: () => of(undefined),
              sendTyping: vi.fn(),
              sendMessage: send,
            },
          },
          {
            provide: RealtimeService,
            useValue: {
              events$: EMPTY,
              typing$: EMPTY,
              typingForTag: () => EMPTY,
              messagesForTag: () => EMPTY,
            },
          },
          { provide: AuthService, useValue: { user: signal({ _id: 'me' }) } },
          { provide: UiStateService, useValue: { setChatInputFocused: vi.fn() } },
          {
            provide: BotActivityService,
            useValue: {
              inThreadBySource: signal(new Map()),
              topLevelByNotebook: signal(new Map()),
            },
          },
        ],
      });
      TestBed.overrideComponent(componentType, {
        set: {
          imports: [MentionSuggestionComponent],
          template: `<div #${thread ? 'threadEditorElement' : 'editorElement'}></div>@if(showMentionSuggestions()) { <app-mention-suggestion [items]="mentionSuggestions()" [isLoading]="mentionSuggestionsLoading()" (selected)="onMentionSelected($event)" (dismissed)="onMentionDismissed()" /> }`,
        },
      });
      const fixture = TestBed.createComponent(componentType);
      fixture.componentRef.setInput('notebookId', 'notebook');
      if (thread)
        fixture.componentRef.setInput('parentMessage', {
          id: 'parent',
          pageId: 'page',
          content: { type: 'doc', content: [] },
        } as unknown as Message);
      fixture.detectChanges();
      await fixture.whenStable();
      const editor = Reflect.get(fixture.componentInstance, 'editor') as Editor;
      editor.view.dom.focus();
      editor.commands.insertContent('@');
      await fixture.whenStable();
      fixture.detectChanges();
      const key = (key: string) =>
        editor.view.dom.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        );
      return { fixture, editor, key };
    }
    beforeEach(() => {
      send.mockClear();
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => new DOMRect(),
      });
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: () => [],
      });
    });
    afterEach(() => {
      TestBed.resetTestingModule();
      vi.restoreAllMocks();
    });
    it('selects with ArrowDown and Enter without sending the message', async () => {
      const { fixture, editor, key } = await setup();
      key('ArrowDown');
      fixture.detectChanges();
      key('Enter');
      await fixture.whenStable();
      expect(extractMentions(editor.getJSON()).map((mention) => mention.handle)).toEqual(['cedar']);
      expect(send).not.toHaveBeenCalled();
      fixture.destroy();
    });
    it('updates an already open picker when bots finish loading', async () => {
      const { fixture } = await setup([]);
      lookups.next(bots);
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.componentInstance.mentionSuggestions()).toHaveLength(2);
      fixture.destroy();
    });
    it('keeps editor focus during pointer selection and retains the mention when pasted', async () => {
      const { fixture, editor } = await setup();
      const option = fixture.nativeElement.querySelector(
        'app-mention-suggestion button',
      ) as HTMLButtonElement;
      const down = new Event('pointerdown', { bubbles: true, cancelable: true });
      option.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      option.click();
      await fixture.whenStable();
      const html = editor.getHTML();
      editor.commands.setContent(html);
      expect(extractMentions(editor.getJSON()).map((mention) => mention.handle)).toEqual(['maple']);
      fixture.destroy();
    });
    it('dismisses with Escape without closing the thread or sending', async () => {
      const { fixture, editor, key } = await setup();
      const closed = vi.fn();
      const subscription = thread
        ? (fixture.componentInstance as ThreadPanelComponent).closed.subscribe(closed)
        : undefined;
      key('Escape');
      await fixture.whenStable();
      expect(fixture.componentInstance.showMentionSuggestions()).toBe(false);
      expect(editor.getText()).toBe('@');
      expect(send).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
      subscription?.unsubscribe();
      fixture.destroy();
    });
    it('keeps Shift+Enter as a newline rather than picking or sending', async () => {
      const { fixture, editor } = await setup();
      editor.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await fixture.whenStable();
      expect(extractMentions(editor.getJSON())).toEqual([]);
      expect(send).not.toHaveBeenCalled();
      fixture.destroy();
    });
  });
