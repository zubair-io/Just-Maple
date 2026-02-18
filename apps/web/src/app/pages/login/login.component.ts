import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { PreferencesService } from '../../services/preferences.service';
import { ButtonComponent, InputComponent, IconComponent } from '../../components/atoms';
import { FormFieldComponent, DividerComponent } from '../../components/molecules';
import { isLocalhost, getApiTarget, setApiTarget, type ApiTarget } from '../../utils/runtime-env';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    InputComponent,
    IconComponent,
    FormFieldComponent,
    DividerComponent,
  ],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  readonly authService = inject(AuthService);
  readonly preferences = inject(PreferencesService);

  readonly isLocal = isLocalhost();
  readonly apiTarget = signal<ApiTarget>(getApiTarget());

  readonly email = signal('');
  readonly emailSent = signal(false);
  readonly devToken = signal<string | null>(null);
  readonly devCode = signal<string | null>(null);
  readonly code = signal('');
  readonly codeError = signal<string | null>(null);

  onSubmit(): void {
    if (!this.email()) return;

    this.authService.requestMagicLink(this.email()).subscribe({
      next: (response) => {
        this.emailSent.set(true);

        // In dev mode, store the token and code for easy testing
        if (response.devToken) {
          this.devToken.set(response.devToken);
        }
        if (response.devCode) {
          this.devCode.set(response.devCode);
        }
      },
      error: () => {
        // Error is handled by auth service
      },
    });
  }

  async verifyCode(): Promise<void> {
    if (!this.code() || this.code().length !== 6) {
      this.codeError.set('Please enter a 6-digit code');
      return;
    }

    this.codeError.set(null);

    try {
      await this.authService.verifyCode(this.email(), this.code());
    } catch (err: any) {
      this.codeError.set(err.message || 'Invalid or expired code');
    }
  }

  reset(): void {
    this.email.set('');
    this.emailSent.set(false);
    this.devToken.set(null);
    this.devCode.set(null);
    this.code.set('');
    this.codeError.set(null);
  }

  onApiTargetChange(event: Event): void {
    const target = (event.target as HTMLSelectElement).value as ApiTarget;
    setApiTarget(target);
    this.apiTarget.set(target);
  }

  async loginWithPasskey(): Promise<void> {
    try {
      // If email is entered, pass it to filter passkeys
      await this.authService.loginWithPasskey(this.email() || undefined);
    } catch {
      // Error is handled by auth service
    }
  }
}
