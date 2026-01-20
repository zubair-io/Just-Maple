# Best Practices Guide

This guide covers coding standards, patterns, and conventions for Just Maple development. Following these practices ensures consistency and maintainability across the codebase.

---

## Code Formatting

### Prettier Configuration

Prettier is required for all code formatting. Configure your editor to format on save.

```json
// .prettierrc
{
    "tabWidth": 4,
    "useTabs": false,
    "singleQuote": true,
    "trailingComma": "all",
    "printWidth": 100,
    "semi": true
}
```

### Commands

```bash
bun run format        # Format all files
bun run format:check  # Check formatting
```

**Do NOT manually format code** - let Prettier handle it.

---

## TypeScript Best Practices

### Strict Mode

TypeScript strict mode is enabled. No exceptions.

```json
// tsconfig.json
{
    "compilerOptions": {
        "strict": true,
        "noImplicitAny": true,
        "strictNullChecks": true,
        "noImplicitReturns": true
    }
}
```

### Type Imports

Always use `import type` for type-only imports:

```typescript
// Good
import type { User, Notebook } from '@maple/shared';
import { validateUser } from '@maple/shared';

// Bad
import { User, Notebook, validateUser } from '@maple/shared';
```

### Avoid `any`

Never use `any`. Use `unknown` and narrow types instead:

```typescript
// Bad
function processData(data: any) {
    return data.name;
}

// Good
function processData(data: unknown): string {
    if (typeof data === 'object' && data !== null && 'name' in data) {
        return String(data.name);
    }
    throw new Error('Invalid data');
}
```

### Type Assertions

Minimize type assertions. Prefer type guards:

```typescript
// Prefer type guards
function isUser(obj: unknown): obj is User {
    return typeof obj === 'object' && obj !== null && 'email' in obj && '_id' in obj;
}

// Avoid type assertions
const user = data as User; // Only when absolutely necessary
```

### Utility Types

Use built-in utility types:

```typescript
// Partial - all properties optional
type UpdateUser = Partial<User>;

// Pick - select specific properties
type UserEmail = Pick<User, 'email' | '_id'>;

// Omit - exclude properties
type CreateUser = Omit<User, '_id' | 'createdAt' | 'updatedAt'>;

// Required - all properties required
type CompleteUser = Required<User>;
```

---

## Angular Best Practices

### Component Structure

Each component must have separate files:

```
components/atoms/button/
├── button.component.ts         # Component class
├── button.component.html       # Template
└── button.component.scss       # Styles (if needed)
```

### Standalone Components

Always use standalone components:

```typescript
@Component({
    selector: 'app-button',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './button.component.html',
    styleUrl: './button.component.scss',
})
export class ButtonComponent {}
```

### Signals for State

Use Angular signals for all component state:

```typescript
// Good - Signals
readonly count = signal(0);
readonly doubled = computed(() => this.count() * 2);

increment(): void {
    this.count.update(c => c + 1);
}

// Bad - BehaviorSubject
private countSubject = new BehaviorSubject(0);
count$ = this.countSubject.asObservable();
```

### Input/Output Functions

Use the new `input()` and `output()` functions (Angular 17+):

```typescript
// Good - Function syntax
readonly variant = input<'primary' | 'secondary'>('primary');
readonly disabled = input<boolean>(false);
readonly clicked = output<void>();

// Avoid - Decorator syntax
@Input() variant: 'primary' | 'secondary' = 'primary';
@Output() clicked = new EventEmitter<void>();
```

### Dependency Injection

Use `inject()` function instead of constructor injection:

```typescript
// Good - inject function
export class MyComponent {
    private readonly http = inject(HttpClient);
    private readonly router = inject(Router);
    private readonly authService = inject(AuthService);
}

// Avoid - Constructor injection
export class MyComponent {
    constructor(
        private http: HttpClient,
        private router: Router,
        private authService: AuthService,
    ) {}
}
```

### Control Flow Syntax

Use the new control flow syntax (Angular 17+):

```html
<!-- Good - New syntax -->
@if (isLoading()) {
<app-spinner />
} @else if (error()) {
<app-error [message]="error()" />
} @else {
<div>Content</div>
} @for (item of items(); track item._id) {
<app-item [data]="item" />
} @empty {
<p>No items found</p>
}

<!-- Avoid - Structural directives -->
<app-spinner *ngIf="isLoading"></app-spinner>
<div *ngFor="let item of items">...</div>
```

### HttpClient Usage

Always use Angular's HttpClient for API calls:

```typescript
// Good - HttpClient with relative URLs
private readonly http = inject(HttpClient);

async getNotebooks(): Promise<Notebook[]> {
    return firstValueFrom(
        this.http.get<Notebook[]>('/api/notebooks')
    );
}

// Bad - Raw fetch
const response = await fetch('/api/notebooks', {
    headers: { Authorization: `Bearer ${token}` }
});
```

### Page Component Separation

Each page component handles one concern only:

```typescript
// Good - Separate pages
// chat-view.component.ts - Only chat
// note-view.component.ts - Only notes
// lego-view.component.ts - Only lego items

// Bad - Combined views
@if (viewType === 'chat') {
    <app-chat />
} @else if (viewType === 'note') {
    <app-note-editor />
}
```

Use route-level switching with `canMatch` guards instead.

---

## Styling Best Practices

### Tailwind CSS

Use Tailwind utility classes as the primary styling method:

```html
<button
    class="px-4 py-2 bg-[var(--color-primary)] text-white rounded-md
           hover:bg-[var(--color-primary-hover)] transition-colors
           disabled:opacity-50 disabled:cursor-not-allowed"
>
    Submit
</button>
```

### Design Tokens

Use CSS variables from `styles.scss`:

| Token                   | Usage                |
| ----------------------- | -------------------- |
| `--color-primary`       | Primary brand color  |
| `--color-primary-hover` | Primary hover state  |
| `--color-bg`            | Background           |
| `--color-bg-secondary`  | Secondary background |
| `--color-text-main`     | Primary text         |
| `--color-text-muted`    | Secondary text       |
| `--color-border`        | Borders              |

```html
<div class="bg-[var(--color-bg)] text-[var(--color-text-main)]"></div>
```

### SCSS Usage

Only use SCSS for:

- Complex animations
- `::before` / `::after` pseudo-elements
- Styles that can't be expressed in Tailwind

```scss
.button {
    &::after {
        content: '';
        position: absolute;
        inset: 0;
        background: currentColor;
        opacity: 0;
        transition: opacity 0.2s;
    }

    &:hover::after {
        opacity: 0.1;
    }
}
```

### Never Use Inline Styles

```html
<!-- Bad -->
<div style="color: red; margin: 10px;">
    <!-- Good -->
    <div class="text-red-500 m-2.5"></div>
</div>
```

---

## API Best Practices

### Repository Pattern

Keep data access in repository files:

```typescript
// repositories/notebook.repo.ts
export async function findById(id: string): Promise<Notebook | null> {
    const doc = await collection().findOne({ _id: new ObjectId(id) as any });
    return doc ? mapNotebook(doc) : null;
}

export async function create(data: CreateNotebook): Promise<Notebook> {
    const result = await collection().insertOne({
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });
    return { _id: result.insertedId.toString(), ...data };
}
```

### Route Structure

Group related routes with prefixes:

```typescript
export const notebookRoutes = new Elysia({ prefix: '/api/notebooks' })
    .use(jwtPlugin)
    .derive(authDerivation)
    .get('/', listHandler)
    .post('/', createHandler, { body: createSchema })
    .get('/:id', getHandler)
    .put('/:id', updateHandler, { body: updateSchema })
    .delete('/:id', deleteHandler);
```

### Error Responses

Return consistent error format:

```typescript
// Always return this structure
{
    error: 'Short error code',
    message: 'Human-readable description'
}

// Examples
{ error: 'Unauthorized', message: 'Invalid or expired token' }
{ error: 'Not found', message: 'Notebook does not exist' }
{ error: 'Validation failed', message: 'Name is required' }
```

### Request Validation

Use TypeBox schemas for all request validation:

```typescript
.post('/', handler, {
    body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        description: t.Optional(t.String({ maxLength: 500 })),
        color: t.Optional(t.String({ pattern: '^#[0-9a-fA-F]{6}$' })),
    }),
})
```

---

## File Naming Conventions

### kebab-case for Files

```
user-profile.component.ts
auth.service.ts
notebook.repo.ts
page-type.guard.ts
```

### Suffixes

| Type        | Suffix                   |
| ----------- | ------------------------ |
| Component   | `.component.ts`          |
| Service     | `.service.ts`            |
| Repository  | `.repo.ts`               |
| Guard       | `.guard.ts`              |
| Interceptor | `.interceptor.ts`        |
| Schema      | `.schema.ts`             |
| Test        | `.spec.ts` or `.test.ts` |

### Directory Structure

```
components/
├── atoms/           # Basic elements: Button, Input, Icon
├── molecules/       # Composed: FormField, SearchBar
├── organisms/       # Complex: Sidebar, NoteEditor, Chat
├── templates/       # Layouts: MainLayout, AuthLayout
└── index.ts         # Barrel exports
```

---

## Git Conventions

### Commit Message Format

```
type: short description

Longer description if needed.
```

### Commit Types

| Type       | Description                           |
| ---------- | ------------------------------------- |
| `feat`     | New feature                           |
| `fix`      | Bug fix                               |
| `refactor` | Code restructure (no behavior change) |
| `docs`     | Documentation only                    |
| `test`     | Adding/updating tests                 |
| `chore`    | Build, deps, tooling                  |

### Examples

```
feat: add notebook sharing functionality
fix: resolve 401 error on token refresh
refactor: extract auth middleware to separate file
docs: update API endpoint documentation
test: add integration tests for message routes
chore: upgrade Angular to v21
```

### Branch Naming

```
feat/notebook-sharing
fix/auth-token-refresh
refactor/extract-auth-middleware
```

---

## Security Best Practices

### Authentication

- Never log tokens or sensitive data
- Use httpOnly cookies for web JWT
- Store tokens in Keychain on native
- Implement proper token refresh

### Input Validation

- Validate all inputs with TypeBox
- Sanitize user-generated content
- Use parameterized queries

### CORS

- Restrict origins to known domains
- Don't use `*` in production

### Secrets

- Use environment variables
- Use Key Vault in production
- Never commit secrets to git

---

## Performance Best Practices

### Angular

- Use `OnPush` change detection where possible
- Use `trackBy` with `@for` loops
- Lazy load routes and components
- Use signals for reactive state

### API

- Create proper database indexes
- Use pagination for large lists
- Implement caching where appropriate
- Use projection to limit returned fields

### General

- Minimize bundle size
- Use tree-shaking
- Compress assets
- Enable gzip/brotli

---

## Avoid Over-Engineering

### Keep It Simple

- Only make changes that are directly requested
- Don't add features beyond what was asked
- Don't add unnecessary abstractions

### What to Avoid

- Don't add error handling for impossible scenarios
- Don't add feature flags unless needed
- Don't create utilities for one-time operations
- Don't design for hypothetical future requirements
- Don't add comments where code is self-explanatory
- Don't add backwards-compatibility shims unnecessarily

### Three Lines vs Abstraction

Three similar lines of code is often better than a premature abstraction:

```typescript
// Good - Simple and clear
const name = user.name;
const email = user.email;
const createdAt = user.createdAt;

// Avoid - Over-abstracted
const extractFields = <T, K extends keyof T>(obj: T, fields: K[]): Pick<T, K> =>
    fields.reduce((acc, field) => ({ ...acc, [field]: obj[field] }), {} as Pick<T, K>);
```

---

## Quick Reference

### Do

| Practice                     |
| ---------------------------- |
| Use Tailwind classes         |
| Use signals for state        |
| Use input() and output()     |
| Use inject() for DI          |
| Use HttpClient for API calls |
| Use design tokens            |
| Separate component files     |
| Run Prettier on save         |
| Use `import type`            |
| One concern per page         |

### Don't

| Anti-pattern                          |
| ------------------------------------- |
| Write custom CSS unless necessary     |
| Use BehaviorSubject in components     |
| Use @Input() and @Output() decorators |
| Use constructor injection             |
| Use raw fetch()                       |
| Hardcode colors                       |
| Use inline templates/styles           |
| Manually format code                  |
| Import types without `type`           |
| Combine views with conditionals       |
| Use `any` type                        |

---

## Related Documentation

- [Architecture](./architecture.md) - System design
- [Web App](./web-app.md) - Angular specifics
- [API](./api.md) - Backend patterns
- [Testing](./testing.md) - Test practices
