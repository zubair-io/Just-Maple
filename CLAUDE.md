# CLAUDE.md - Engineering Style Guide

This file provides guidance to Claude Code and engineers working on Just Maple.

## Project Overview

Just Maple is a note-taking application built as a monorepo using Bun workspaces.

### Structure

```
just-maple/
├── apps/
│   ├── api/          # Elysia backend (Bun + TypeScript)
│   └── web/          # Angular frontend
├── packages/
│   └── shared/       # Shared TypeBox schemas and types
└── designs/          # Figma exports and design specs
```

### Tech Stack

- **Runtime**: Bun
- **API**: Elysia + MongoDB
- **Web**: Angular 19 + Tailwind CSS
- **Shared**: TypeBox schemas

---

## Code Formatting

### Prettier (Required)

- **Run on save** - Configure your editor to format on save
- Settings defined in `.prettierrc`:
    - 4-space indentation
    - Single quotes
    - Trailing commas
    - 100 char line width

```bash
# Manual format
bun run format
```

### Do NOT manually format code - let Prettier handle it.

---

## Styling (Web)

### Tailwind CSS (Primary)

Use Tailwind utility classes for all styling:

```html
<button
    class="px-4 py-2 bg-[var(--color-primary)] text-white rounded-md hover:bg-[var(--color-primary-hover)]"
></button>
```

### Design Tokens

Use CSS variables from `styles.scss`:

- `--color-primary` - Maple red (#D94E3B)
- `--color-bg` - Background
- `--color-text-main` - Primary text
- `--color-text-muted` - Secondary text
- `--color-border` - Borders

### SCSS (When Needed)

Only use SCSS for:

- Complex animations
- `::before` / `::after` pseudo-elements
- Styles that can't be expressed in Tailwind

### Never use inline styles in templates.

---

## Angular Conventions

### Component Files (Separate)

Each component must have separate files:

```
components/atoms/button/
├── button.component.ts
├── button.component.html
└── button.component.scss
```

### Component Structure

```typescript
@Component({
    selector: 'app-button',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './button.component.html',
    styleUrl: './button.component.scss',
})
export class ButtonComponent {
    // Use signals for state
    readonly isLoading = signal(false);

    // Use input() and output() functions
    readonly variant = input<'primary' | 'secondary'>('primary');
    readonly clicked = output<void>();
}
```

### Atomic Design Structure

```
components/
├── atoms/           # Button, Input, Icon
├── molecules/       # FormField, SearchBar
├── organisms/       # Sidebar, NoteEditor
├── templates/       # MainLayout
└── index.ts         # Barrel exports
```

### State Management

- Use **Angular signals** (`signal()`, `computed()`)
- Do NOT use BehaviorSubject or RxJS for component state
- Services can use signals for shared state

### HTTP Requests

**Always use Angular's `HttpClient`** for API calls. Never use raw `fetch()`.

**Why:**

- `HttpClient` uses the environment's base URL configuration
- Auth interceptors automatically attach tokens
- Consistent error handling and retry logic
- Observable-based for better integration with Angular

**Do:**

```typescript
private readonly http = inject(HttpClient);

// Use HttpClient with relative URLs
const data = await firstValueFrom(
    this.http.get<{ state: string }>('/api/notebook/state')
);
```

**Don't:**

```typescript
// BAD: Raw fetch bypasses env config and auth
const response = await fetch('/api/notebook/state', {
    headers: { Authorization: `Bearer ${token}` },
});
```

### Routing

- Use ID-based routes: `/:tagId/:noteId`
- Keep route params simple and stable

### Page Component Separation

Each page component should handle **one concern only**. Do not combine multiple views into a single component with conditional rendering.

**Do:**

```typescript
// chat-view.component.ts - Only handles chat/messages
// note-view.component.ts - Only handles note editing
// lego-view.component.ts - Only handles lego items
```

**Don't:**

```typescript
// bad: single component handling multiple concerns
@if (hasNote) {
    <app-note-editor />
} @else {
    <app-chat />
}
```

**Use route-level switching**, not component-level:

```typescript
// app.routes.ts
{ path: ':tagId', loadComponent: () => import('./pages/chat-view/...') },
{ path: ':tagId/:noteId', canMatch: [WriteNoteGuard], loadComponent: () => import('./pages/note-view/...') },
{ path: ':tagId/:noteId', canMatch: [LegoNoteGuard], loadComponent: () => import('./pages/lego-view/...') },
```

Route guards (`canMatch`) determine which component loads based on data (e.g., note type). Components should not need to know about other view types.

---

## API Conventions (Elysia)

### File Structure

```
src/
├── routes/          # API endpoints
├── repositories/    # Data access (*.repo.ts)
├── services/        # Business logic
├── middleware/      # Auth, logging
└── db/              # Database connection
```

### Repository Pattern

```typescript
// user.repo.ts
export async function findUserById(id: string): Promise<User | null> {
    const user = await db.collection('users').findOne({ _id: new ObjectId(id) });
    return user ? mapUser(user) : null;
}
```

### Route Handlers

```typescript
export const tagRoutes = new Elysia({ prefix: '/api/tags' })
    .use(jwtPlugin)
    .derive(async ({ jwt, request }) => {
        // Auth logic inline
    })
    .get('/', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized' };
        }
        return { tags: await findTagsByUserId(auth.user._id) };
    });
```

### Error Responses

```typescript
{ error: 'Not found', message: 'Tag does not exist' }
```

---

## TypeScript

### Strict Mode

TypeScript strict mode is enabled. No exceptions.

### Type Imports

```typescript
import type { Tag, Note } from '@maple/shared';
```

### Avoid `any`

Use `unknown` and narrow types, or define proper interfaces.

### Shared Types

Define types in `@maple/shared` for use across API and Web:

```typescript
// packages/shared/src/schemas/tag.ts
export const TagSchema = Type.Object({
    _id: Type.String(),
    label: Type.String(),
    // ...
});
export type Tag = Static<typeof TagSchema>;
```

---

## File Naming

### kebab-case for files

```
user-profile.component.ts
auth.service.ts
tag.repo.ts
```

### Suffixes

| Type       | Suffix                        |
| ---------- | ----------------------------- |
| Component  | `.component.ts`               |
| Service    | `.service.ts`                 |
| Repository | `.repo.ts`                    |
| Guard      | `.guard.ts`                   |
| Schema     | `.schema.ts` (or in schemas/) |

---

## Git Conventions

### Commit Format

```
type: short description

Longer description if needed.
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code restructure (no behavior change)
- `docs`: Documentation only
- `test`: Adding/updating tests
- `chore`: Build, deps, tooling

### Examples

```
feat: add tag creation from sidebar
fix: resolve 401 on tags API
refactor: extract auth middleware to separate file
```

---

## Development Commands

```bash
# Start dev servers
bun run dev

# Format code
bun run format

# Run tests
bun run test

# Type check
bun run typecheck
```

---

## Quick Reference

| Do                             | Don't                               |
| ------------------------------ | ----------------------------------- |
| Use Tailwind classes           | Write custom CSS unless necessary   |
| Use signals for state          | Use BehaviorSubject in components   |
| Separate component files       | Inline templates/styles             |
| Run Prettier on save           | Manually format code                |
| Use `import type`              | Import types without `type` keyword |
| Use design tokens              | Hardcode colors                     |
| One concern per page component | Combine views with conditionals     |
| Route-level view switching     | Component-level type checking       |
| Use HttpClient for API calls   | Use raw fetch()                     |
