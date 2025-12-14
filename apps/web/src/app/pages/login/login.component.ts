import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { ButtonComponent, InputComponent, IconComponent } from '../../components/atoms';
import { FormFieldComponent, DividerComponent } from '../../components/molecules';

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

  readonly email = signal('');
  readonly emailSent = signal(false);
  readonly devToken = signal<string | null>(null);

  async onSubmit(): Promise<void> {
    if (!this.email()) return;

    try {
      const response = await this.authService.requestMagicLink(this.email());
      this.emailSent.set(true);

      // In dev mode, store the token for easy testing
      if (response.devToken) {
        this.devToken.set(response.devToken);
      }
    } catch {
      // Error is handled by auth service
    }
  }

  reset(): void {
    this.email.set('');
    this.emailSent.set(false);
    this.devToken.set(null);
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
