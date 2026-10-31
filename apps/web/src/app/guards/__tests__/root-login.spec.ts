import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ReplaySubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app.routes';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'test-root-layout',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class LayoutStub {}

@Component({ selector: 'test-root-welcome', standalone: true, template: 'Notebooks' })
class WelcomeStub {}

@Component({ selector: 'test-root-login', standalone: true, template: 'Login' })
class LoginStub {}

describe('root login routing', () => {
  const authenticated = signal(false);
  let ready: ReplaySubject<boolean>;

  beforeEach(() => {
    authenticated.set(false);
    ready = new ReplaySubject<boolean>(1);
    const layout = routes.find((route) => route.path === '' && route.children)!;
    const root = layout.children!.find((route) => route.path === '')!;
    const login = routes.find((route) => route.path === 'login')!;
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { isAuthenticated: authenticated, initReady$: ready } },
        provideRouter([
          { path: 'login', component: LoginStub, canActivate: login.canActivate?.slice(1) },
          {
            path: '',
            component: LayoutStub,
            canMatch: layout.canMatch,
            children: [{ ...root, loadComponent: undefined, component: WelcomeStub }],
          },
        ]),
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('redirects a signed-out root visit to login on the same site', async () => {
    ready.next(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/', LoginStub);
    expect(TestBed.inject(Router).url).toBe('/login');
  });

  it('keeps signed-in root visits on notebooks without a login redirect loop', async () => {
    authenticated.set(true);
    ready.next(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');
    expect(TestBed.inject(Router).url).toBe('/');
    expect(harness.routeNativeElement?.textContent).toContain('Notebooks');
  });

  it('waits for the saved session before deciding to redirect', async () => {
    const harness = await RouterTestingHarness.create();
    let finished = false;
    const navigation = harness.navigateByUrl('/').then(() => (finished = true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(finished).toBe(false);
    authenticated.set(true);
    ready.next(true);
    await navigation;
    expect(TestBed.inject(Router).url).toBe('/');
    expect(harness.routeNativeElement?.textContent).toContain('Notebooks');
  });
});
