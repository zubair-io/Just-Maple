import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-verify',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="verify-container">
      <div class="verify-card">
        @if (authService.isLoading()) {
          <div class="loading">
            <p>Verifying your magic link...</p>
            <div class="spinner"></div>
          </div>
        } @else if (authService.error()) {
          <div class="error-state">
            <h2>Verification Failed</h2>
            <p>{{ authService.error() }}</p>
            <button (click)="goToLogin()">Back to Login</button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .verify-container {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        padding: 1rem;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      }

      .verify-card {
        background: white;
        padding: 2rem;
        border-radius: 8px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        width: 100%;
        max-width: 400px;
        text-align: center;
      }

      .loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
      }

      .spinner {
        width: 40px;
        height: 40px;
        border: 3px solid #f3f3f3;
        border-top: 3px solid #667eea;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      .error-state h2 {
        color: #dc3545;
        margin-bottom: 1rem;
      }

      .error-state p {
        color: #666;
        margin-bottom: 1.5rem;
      }

      button {
        padding: 0.75rem 1.5rem;
        background: #667eea;
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 1rem;
        cursor: pointer;
      }

      button:hover {
        background: #5a6fd6;
      }
    `,
  ],
})
export class VerifyComponent implements OnInit {
  readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');

    if (!token) {
      this.router.navigate(['/login']);
      return;
    }

    this.authService.verifyToken(token).catch(() => {
      // Error is handled by auth service
    });
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }
}
