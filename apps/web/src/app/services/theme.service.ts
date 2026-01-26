import { Injectable, signal, effect, computed } from '@angular/core';

export type ThemeId = 'light' | 'dark' | 'solarized' | 'warm' | 'cool' | 'rose' | 'forest';

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
export class ThemeService {
  /** All available themes */
  readonly themes = THEMES;

  /** Currently selected theme ID */
  readonly currentThemeId = signal<ThemeId>(this.loadTheme());

  /** Current theme object */
  readonly currentTheme = computed(
    () => this.themes.find((t) => t.id === this.currentThemeId()) ?? this.themes[0],
  );

  /** Whether dark scrollbars should be used */
  readonly isDarkTheme = computed(() => this.currentThemeId() === 'dark');

  constructor() {
    // Effect to apply theme to DOM and persist to localStorage
    effect(() => {
      const themeId = this.currentThemeId();
      this.applyTheme(themeId);
      this.saveTheme(themeId);
    });
  }

  /** Set the active theme */
  setTheme(themeId: ThemeId): void {
    this.currentThemeId.set(themeId);
  }

  /** Toggle between light and dark themes */
  toggleDarkMode(): void {
    const current = this.currentThemeId();
    this.currentThemeId.set(current === 'dark' ? 'light' : 'dark');
  }

  /** Apply theme to the document */
  private applyTheme(themeId: ThemeId): void {
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
      return 'light';
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && this.themes.some((t) => t.id === stored)) {
      return stored as ThemeId;
    }

    // Check for system dark mode preference
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }

    return 'light';
  }

  /** Save theme to localStorage */
  private saveTheme(themeId: ThemeId): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, themeId);
    }
  }
}
