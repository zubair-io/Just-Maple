import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { EMPTY, of } from 'rxjs';
import { ChatComponent } from '../chat.component';
import { MessageService } from '../../../../services/message.service';
import { RealtimeService } from '../../../../services/realtime.service';
import { AuthService } from '../../../../services/auth.service';
import { UiStateService } from '../../../../services/ui-state.service';
import { BotService } from '../../../../services/bot.service';
import { BotActivityService } from '../../../../services/bot-activity.service';

describe('ChatComponent loading', () => {
  function setup() {
    const messageService = {
      messagesForTag: signal([]),
      hasMore: signal(false),
      isLoading: signal(false),
      historyError: signal(null),
      failedSends: signal(new Map()),
      loadMessages: vi.fn(() => of([])),
      loadMessagesByPageId: vi.fn(() => of([])),
    };
    TestBed.configureTestingModule({
      imports: [ChatComponent],
      providers: [
        { provide: MessageService, useValue: messageService },
        {
          provide: RealtimeService,
          useValue: { typingForTag: () => EMPTY, messagesForTag: () => EMPTY },
        },
        { provide: AuthService, useValue: { user: signal(null) } },
        { provide: UiStateService, useValue: { setChatInputFocused: vi.fn() } },
        {
          provide: BotService,
          useValue: { notebookBotsCacheVersion: signal(0), getNotebookBots: () => of([]) },
        },
        {
          provide: BotActivityService,
          useValue: { topLevelByNotebook: signal(new Map()), inThreadBySource: signal(new Map()) },
        },
      ],
    });
    TestBed.overrideComponent(ChatComponent, { set: { template: '', imports: [] } });
    const fixture = TestBed.createComponent(ChatComponent);
    return { fixture, messageService };
  }

  it('loads the open messages page only, not the notebook default chat as well', () => {
    const { fixture, messageService } = setup();
    fixture.componentRef.setInput('notebookId', 'n1');
    fixture.componentRef.setInput('pageId', 'chat2');
    fixture.detectChanges();
    fixture.detectChanges();
    expect(messageService.loadMessagesByPageId).toHaveBeenCalledTimes(1);
    expect(messageService.loadMessagesByPageId).toHaveBeenCalledWith('chat2');
    expect(messageService.loadMessages).not.toHaveBeenCalled();

    fixture.componentRef.setInput('pageId', 'chat3');
    fixture.detectChanges();
    expect(messageService.loadMessagesByPageId).toHaveBeenLastCalledWith('chat3');
    fixture.destroy();
  });

  it('loads the notebook default chat when no page is given', () => {
    const { fixture, messageService } = setup();
    fixture.componentRef.setInput('notebookId', 'n1');
    fixture.detectChanges();
    expect(messageService.loadMessages).toHaveBeenCalledWith('n1');
    expect(messageService.loadMessagesByPageId).not.toHaveBeenCalled();
    fixture.destroy();
  });
});
