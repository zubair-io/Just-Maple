import { ServerSettingsComponent } from '../../components/molecules/server-settings/server-settings.component';
import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { environment } from '../../../environments/environment';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { ButtonComponent, InputComponent, IconComponent } from '../../components/atoms';
import { FormFieldComponent } from '../../components/molecules';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    ServerSettingsComponent,
    FormsModule,
    ButtonComponent,
    InputComponent,
    IconComponent,
    FormFieldComponent,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './login.component.html',
})
export class LoginComponent {
  readonly authService = inject(AuthService);
  readonly creatingAccount = signal(false);
  readonly displayName = signal('');

  readonly devTokenLogin =
    !environment.production &&
    typeof location !== 'undefined' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  readonly devEmail = signal('');
  readonly devToken = signal('');

  async loginWithDevToken(): Promise<void> {
    if (!this.devEmail().trim() || !this.devToken().trim() || this.authService.isLoading()) return;
    try {
      await this.authService.loginWithDevToken(this.devEmail(), this.devToken());
      this.devToken.set('');
    } catch {
      // The service exposes the error for display.
    }
  }

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
