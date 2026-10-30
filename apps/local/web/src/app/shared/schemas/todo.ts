import { Type, Static } from '@sinclair/typebox';

// Todo priority levels
export const TodoPrioritySchema = Type.Union([
  Type.Literal('high'),
  Type.Literal('medium'),
  Type.Literal('low'),
]);

export type TodoPriority = Static<typeof TodoPrioritySchema>;

// Todo color options
export const TodoColorSchema = Type.Union([
  Type.Literal('red'),
  Type.Literal('orange'),
  Type.Literal('yellow'),
  Type.Literal('green'),
  Type.Literal('blue'),
]);

export type TodoColor = Static<typeof TodoColorSchema>;

// TodoIndex - denormalized todo for queries (stored in page metadata)
export const TodoIndexSchema = Type.Object({
  id: Type.String(), // Node ID for deep linking
  text: Type.String({ maxLength: 100 }), // First 100 chars of content
  checked: Type.Boolean(), // Completion state
  dueDate: Type.Optional(Type.String({ format: 'date-time' })), // Due date if set
  priority: Type.Optional(TodoPrioritySchema), // Priority if set
  color: Type.Optional(TodoColorSchema), // Color if set
});

export type TodoIndex = Static<typeof TodoIndexSchema>;

// PageTodoMeta - todo metadata stored on page for efficient querying
export const PageTodoMetaSchema = Type.Object({
  todoCount: Type.Number(), // Total todos
  completedCount: Type.Number(), // Completed todos
  hasTodos: Type.Boolean(), // Quick filter flag
  nextDueDate: Type.Optional(Type.String({ format: 'date-time' })), // Earliest incomplete due date
  overdueCount: Type.Number(), // Overdue incomplete count
  todos: Type.Array(TodoIndexSchema), // Denormalized for queries
});

export type PageTodoMeta = Static<typeof PageTodoMetaSchema>;

// TodoQueryResult - extended todo with parent memo info (for folder view)
export const TodoQueryResultSchema = Type.Intersect([
  TodoIndexSchema,
  Type.Object({
    memoId: Type.String(), // Parent memo ID
    memoTitle: Type.String(), // Parent memo title
  }),
]);

export type TodoQueryResult = Static<typeof TodoQueryResultSchema>;

// TodoDeepLink - parameters for deep linking to a todo
export const TodoDeepLinkSchema = Type.Object({
  memoId: Type.String(),
  todoId: Type.String(),
});

export type TodoDeepLink = Static<typeof TodoDeepLinkSchema>;

// Default empty todo metadata
export const DEFAULT_TODO_META: PageTodoMeta = {
  todoCount: 0,
  completedCount: 0,
  hasTodos: false,
  overdueCount: 0,
  todos: [],
};
