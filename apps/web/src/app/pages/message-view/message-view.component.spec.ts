import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of, tap } from 'rxjs';
import { MessageViewComponent } from './message-view.component';
import { MessageService } from '../../services/message.service';
import { NotificationService } from '../../services/notification.service';
import { NotebookService } from '../../services/notebook.service';
import { PageService } from '../../services/page.service';

describe('MessageViewComponent', () => {
  function setup() {
    // Like the real service: marking read reads message state, and its reply updates it.
    const unreadCounts = signal([{ pageId: 'chat', notebookId: 'n1', count: 3 }]);
    const messageService = {
      clearMessages: vi.fn(),
      markAsReadByPageId: vi.fn(() => {
        unreadCounts();
        return of(undefined).pipe(tap(() => unreadCounts.set([])));
      }),
    };
    const params = new BehaviorSubject(convertToParamMap({ notebookId: 'n1', id: 'chat' }));
    TestBed.configureTestingModule({
      imports: [MessageViewComponent],
      providers: [
        { provide: MessageService, useValue: messageService },
        { provide: NotificationService, useValue: { setActiveNotebook: vi.fn() } },
        {
          provide: NotebookService,
          useValue: { notebooks: signal([]), fetchNotebookMembers: vi.fn(() => of([])) },
        },
        { provide: PageService, useValue: { pages: signal([]) } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params,
            params: of({ notebookId: 'n1', id: 'chat' }),
            snapshot: { paramMap: params.value },
          },
        },
      ],
    });
    TestBed.overrideComponent(MessageViewComponent, { set: { template: '', imports: [] } });
    const fixture = TestBed.createComponent(MessageViewComponent);
    const settle = () => {
      for (let i = 0; i < 5; i++) {
        fixture.detectChanges();
        TestBed.tick();
      }
    };
    return { fixture, messageService, settle };
  }

  it('marks a chat read once when it opens, not again on every update', () => {
    const { fixture, messageService, settle } = setup();
    fixture.componentInstance.selectedNotebookId.set('n1');
    fixture.componentInstance.selectedPageId.set('chat');
    settle();
    expect(messageService.markAsReadByPageId).toHaveBeenCalledTimes(1);
    expect(messageService.markAsReadByPageId).toHaveBeenCalledWith('chat', 'n1');
    fixture.destroy();
  });

  it('marks the next chat read when switching chats', () => {
    const { fixture, messageService, settle } = setup();
    fixture.componentInstance.selectedNotebookId.set('n1');
    fixture.componentInstance.selectedPageId.set('chat');
    settle();
    fixture.componentInstance.selectedPageId.set('chat2');
    settle();
    expect(messageService.markAsReadByPageId.mock.calls.map((c) => c[0])).toEqual([
      'chat',
      'chat2',
    ]);
    fixture.destroy();
  });
});
