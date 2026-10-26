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
  it('loads and marks a chat read once when it opens, not again on every update', () => {
    // Like the real service: both calls read message state, and their replies update it.
    const unreadCounts = signal([{ pageId: 'chat', notebookId: 'n1', count: 3 }]);
    const currentPage = signal<{ id: string } | null>(null);
    const messageService = {
      clearMessages: vi.fn(),
      loadMessagesByPageId: vi.fn(() => {
        currentPage();
        return of([]).pipe(tap(() => currentPage.set({ id: 'chat' })));
      }),
      markAsReadByPageId: vi.fn(() => {
        unreadCounts();
        return of(undefined).pipe(tap(() => unreadCounts.set([])));
      }),
    };
    const params = new BehaviorSubject(convertToParamMap({ tagId: 'n1', id: 'chat' }));
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
            params: of({ tagId: 'n1', id: 'chat' }),
            snapshot: { paramMap: params.value },
          },
        },
      ],
    });
    TestBed.overrideComponent(MessageViewComponent, { set: { template: '', imports: [] } });
    const fixture = TestBed.createComponent(MessageViewComponent);
    fixture.componentInstance.selectedNotebookId.set('n1');
    fixture.componentInstance.selectedPageId.set('chat');
    for (let i = 0; i < 5; i++) {
      fixture.detectChanges();
      TestBed.tick();
    }
    expect(messageService.loadMessagesByPageId).toHaveBeenCalledTimes(1);
    expect(messageService.markAsReadByPageId).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });
});
