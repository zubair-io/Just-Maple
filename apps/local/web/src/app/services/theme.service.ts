import { Injectable, signal, effect, computed, OnDestroy } from '@angular/core';

export type ThemeId =
  | 'system'
  | 'light'
  | 'dark'
  | 'solarized'
  | 'warm'
  | 'cool'
  | 'rose'
  | 'forest';

/** Theme IDs that can be applied to the DOM (excludes 'system') */
export type AppliedThemeId = Exclude<ThemeId, 'system'>;

export interface Theme {
  id: ThemeId;
  name: string;
  description: string;
  icon: string;
  preview: {
    bg: string;
    surface: string;
    primary: string;
    text: string;
  };
}

const THEMES: Theme[] = [
  {
    id: 'system',
    name: 'System',
    description: 'Follows your device settings',
    icon: 'contrast',
    preview: { bg: '#fdfbf7', surface: '#ffffff', primary: '#d94e3b', text: '#292524' },
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Default light theme',
    icon: 'light_mode',
    preview: { bg: '#fdfbf7', surface: '#ffffff', primary: '#d94e3b', text: '#292524' },
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Easy on the eyes at night',
    icon: 'dark_mode',
    preview: { bg: '#1c1917', surface: '#262524', primary: '#d94e3b', text: '#e7e5e4' },
  },
  {
    id: 'solarized',
    name: 'Solarized',
    description: 'Warm, low-contrast for extended reading',
    icon: 'wb_sunny',
    preview: { bg: '#fdf6e3', surface: '#eee8d5', primary: '#b58900', text: '#657b83' },
  },
  {
    id: 'warm',
    name: 'Warm',
    description: 'Cozy earth tones',
    icon: 'local_fire_department',
    preview: { bg: '#faf5f0', surface: '#fff8f0', primary: '#c2410c', text: '#422006' },
  },
  {
    id: 'cool',
    name: 'Cool',
    description: 'Calm blue-grey palette',
    icon: 'ac_unit',
    preview: { bg: '#f0f4f8', surface: '#ffffff', primary: '#2563eb', text: '#1e293b' },
  },
  {
    id: 'rose',
    name: 'Rose',
    description: 'Soft pink aesthetic',
    icon: 'favorite',
    preview: { bg: '#fdf2f8', surface: '#ffffff', primary: '#db2777', text: '#4a044e' },
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Nature-inspired greens',
    icon: 'park',
    preview: { bg: '#f0fdf4', surface: '#ffffff', primary: '#16a34a', text: '#14532d' },
  },
];

const STORAGE_KEY = 'maple-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService implements OnDestroy {
  /** All available themes */
  readonly themes = THEMES;

  /** Currently selected theme ID (may be 'system') */
  readonly currentThemeId = signal<ThemeId>(this.loadTheme());

  /** System preference for dark mode */
  readonly systemPrefersDark = signal(this.getSystemPreference());

  /** The actual theme being applied (resolves 'system' to light/dark) */
  readonly effectiveThemeId = computed<AppliedThemeId>(() => {
    const selected = this.currentThemeId();
    if (selected === 'system') {
      return this.systemPrefersDark() ? 'dark' : 'light';
    }
    return selected;
  });

  /** Current theme object */
  readonly currentTheme = computed(
    () => this.themes.find((t) => t.id === this.currentThemeId()) ?? this.themes[0],
  );

  /** Whether dark scrollbars should be used */
  readonly isDarkTheme = computed(() => this.effectiveThemeId() === 'dark');

  private mediaQuery: MediaQueryList | null = null;
  private mediaQueryHandler = (e: MediaQueryListEvent) => {
    this.systemPrefersDark.set(e.matches);
  };

  constructor() {
    // Listen to system preference changes
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.mediaQuery.addEventListener('change', this.mediaQueryHandler);
    }

    // Effect to apply theme to DOM and persist to localStorage
    effect(() => {
      const themeId = this.effectiveThemeId();
      this.applyTheme(themeId);
    });

    // Separate effect to save the selected theme (not the effective one)
    effect(() => {
      const themeId = this.currentThemeId();
      this.saveTheme(themeId);
    });
  }

  ngOnDestroy(): void {
    if (this.mediaQuery) {
      this.mediaQuery.removeEventListener('change', this.mediaQueryHandler);
    }
  }

  /** Set the active theme */
  setTheme(themeId: ThemeId): void {
    this.currentThemeId.set(themeId);
  }

  /** Toggle between light and dark themes */
  toggleDarkMode(): void {
    const effective = this.effectiveThemeId();
    this.currentThemeId.set(effective === 'dark' ? 'light' : 'dark');
  }

  /** Get system dark mode preference */
  private getSystemPreference(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return false;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /** Apply theme to the document */
  private applyTheme(themeId: AppliedThemeId): void {
    const html = document.documentElement;

    // Remove all theme classes
    html.classList.remove(
      'dark',
      'theme-solarized',
      'theme-warm',
      'theme-cool',
      'theme-rose',
      'theme-forest',
    );
    html.removeAttribute('data-theme');

    // Apply new theme
    if (themeId === 'dark') {
      html.classList.add('dark');
      html.setAttribute('data-theme', 'dark');
      this.updateMetaThemeColor('#1c1917');
    } else if (themeId !== 'light') {
      html.classList.add(`theme-${themeId}`);
      html.setAttribute('data-theme', themeId);
      this.updateMetaThemeColor(this.getThemeBgColor(themeId));
    } else {
      this.updateMetaThemeColor('#fdfbf7');
    }
  }

  /** Get background color for a theme */
  private getThemeBgColor(themeId: ThemeId): string {
    const theme = this.themes.find((t) => t.id === themeId);
    return theme?.preview.bg ?? '#fdfbf7';
  }

  /** Update the meta theme-color for mobile browsers */
  private updateMetaThemeColor(color: string): void {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', color);
    }
  }

  /** Load theme from localStorage */
  private loadTheme(): ThemeId {
    if (typeof localStorage === 'undefined') {
      return 'system';
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && this.themes.some((t) => t.id === stored)) {
      return stored as ThemeId;
    }

    // Default to system theme
    return 'system';
  }

  /** Save theme to localStorage */
  private saveTheme(themeId: ThemeId): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, themeId);
    }
  }
}
