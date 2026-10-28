import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, Subject } from 'rxjs';
import type { ChatEvent, Page } from '@maple/shared';
import { ActivityViewComponent } from './activity-view.component';
import { PageService } from '../../services/page.service';
import { RealtimeService } from '../../services/realtime.service';
import { AuthService } from '../../services/auth.service';

describe('ActivityViewComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    const page = {
      id: 'activity-nb1',
      type: 'activity',
      title: 'Activity',
      notebookId: 'nb1',
    } as Page;
    TestBed.configureTestingModule({
      imports: [ActivityViewComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: 'activity-nb1' })),
            snapshot: { paramMap: convertToParamMap({ id: 'activity-nb1' }) },
          },
        },
        { provide: PageService, useValue: { pages: signal([page]) } },
        { provide: RealtimeService, useValue: { events$: new Subject<ChatEvent>() } },
        { provide: AuthService, useValue: { user: signal({ _id: 'owner' }) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('lists the activity of the page’s notebook', async () => {
    const fixture = TestBed.createComponent(ActivityViewComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const request = http.expectOne((r) => r.url === '/api/bot-actions');
    expect(request.request.params.get('notebookId')).toBe('nb1');
    expect(request.request.params.has('botId')).toBe(false);
    request.flush({ actions: [] });
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('h1')?.textContent).toContain('Activity');
    expect(host.querySelector('[data-testid=empty]')?.textContent).toContain('Nothing yet');
  });
});
