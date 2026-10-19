import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { ButtonComponent, InputComponent, IconComponent } from '../../components/atoms';
import { FormFieldComponent } from '../../components/molecules';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, ButtonComponent, InputComponent, IconComponent, FormFieldComponent],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  readonly authService = inject(AuthService);
  readonly creatingAccount = signal(false);
  readonly displayName = signal('');

  async onSubmit(): Promise<void> {
    if (!this.displayName().trim() || this.authService.isLoading()) return;
    try {
      await this.authService.signupWithPasskey(this.displayName());
    } catch {
      // The service exposes the error for display.
    }
  }

  async loginWithPasskey(): Promise<void> {
    try {
      await this.authService.loginWithPasskey();
    } catch {
      // The service exposes the error for display.
    }
  }
}
