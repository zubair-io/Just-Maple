# Enhanced Todos

Just Maple extends standard task lists with priority levels, due dates, and color coding. Track todos across all your notebooks and never miss a deadline.

## Creating Todos

### In the Editor

Type `[]` or `[ ]` followed by a space to create a task:

```
[] Buy groceries
[] Review project proposal
```

Or use the toolbar's task list button to convert paragraphs to tasks.

### From the Toolbar

1. Click the checkbox icon in the toolbar
2. Start typing your task
3. Press Enter to create the next task

## Task Attributes

### Priority Levels

Set importance for each task:

| Priority | Color | Use For                  |
| -------- | ----- | ------------------------ |
| High     | Red   | Urgent, blocking items   |
| Medium   | Amber | Important but not urgent |
| Low      | Blue  | Nice-to-have, backlog    |
| None     | Gray  | Default, unprioritized   |

**To set priority:**

1. Place cursor in the task
2. Click the priority button in the toolbar
3. Select a level

### Due Dates

Set deadlines to track when tasks should be completed:

1. Place cursor in the task
2. Click the calendar icon in the toolbar
3. Select a date

Tasks with due dates show:

- Days remaining (e.g., "Due in 3 days")
- Overdue indicator (red highlight when past due)

### Color Coding

Use colors for visual organization:

1. Place cursor in the task
2. Click the color picker in the toolbar
3. Choose a color

Colors appear as a left border on the task, useful for categorizing by project or context.

## Completing Tasks

### Toggle Completion

- Click the checkbox to complete/uncomplete
- Completed tasks show with strikethrough
- Completion state syncs across all devices

### Keyboard Shortcut

With cursor in a task, press `Cmd/Ctrl + Enter` to toggle completion.

## Todo View

Access all todos across your notebooks in one place:

### Opening Todo View

1. Click "Todos" in the sidebar
2. Or navigate to `/:notebookId/todos`

### Filtering

Filter todos by:

- **Status** - Pending, Completed, All
- **Priority** - High, Medium, Low
- **Due date** - Overdue, Due today, Due this week
- **Notebook** - Specific notebook or all

### Sorting

Sort by:

- Due date (soonest first)
- Priority (highest first)
- Created date (newest first)
- Notebook name

## Todo Statistics

### Page-level Stats

Each page tracks:

- Total todo count
- Completed count
- Overdue count

### Notebook Summary

The notebook overview shows aggregated stats:

```
Project Alpha
├── 12 total todos
├── 8 completed
└── 2 overdue
```

## Integrations

### AI Writing Assistant

The AI can help with tasks:

- "Create a task list for planning a product launch"
- "Break this down into actionable tasks"

### Bots

Bots can create and manage tasks:

- Auto-create follow-up tasks from meeting notes
- Parse action items from chat messages

## Keyboard Shortcuts

| Action               | Shortcut               |
| -------------------- | ---------------------- |
| Create task          | `[]` then Space        |
| Toggle completion    | `Cmd/Ctrl + Enter`     |
| New task below       | `Enter` at end of task |
| Convert to paragraph | `Backspace` at start   |
| Set high priority    | _(from toolbar)_       |
| Set due date         | _(from toolbar)_       |

## Tips & Best Practices

### Task Organization

- Use one notebook per project for focused task lists
- Archive completed pages to keep active lists clean
- Use tags like `#todo` or `#action` for additional filtering

### Due Dates

- Set realistic due dates
- Review overdue items regularly
- Use the todo view to triage upcoming deadlines

### Priority Usage

- Reserve "High" for truly urgent items
- Most tasks can be "Medium" or "Low"
- Update priorities as situations change

## Related Documentation

- [Memo Editor](./feature-memo-editor.md) - Where todos live
- [Search](./feature-search.md) - Finding todos
- [AI Writing Assistant](./feature-ai-writing.md) - AI-generated task lists
- [Engineering: Todos](./eng-todos.md) - Technical implementation
