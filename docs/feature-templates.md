# Templates

Templates help you quickly create consistent documents for recurring workflows. Use system templates or create your own.

## Using Templates

### Creating from Template

1. Click the **+** button to create a new page
2. Select "New from template"
3. Choose a template from the gallery
4. A new page is created with the template content

### Template Gallery

The gallery organizes templates by category:

- **Work** - Professional documents
- **Personal** - Personal organization
- **Planning** - Projects and goals
- **Custom** - Your saved templates

## System Templates

Just Maple includes pre-built templates:

### Meeting Notes

Structure for capturing meetings:

```markdown
# Meeting: {{date}}

## Attendees

-

## Agenda

1.

## Discussion Notes

## Action Items

- [ ]

## Next Steps
```

### Daily Journal

Daily reflection template:

```markdown
# {{date}}

## Morning Intentions

-

## Today's Focus

-

## Gratitude

1.
2.
3.

## Evening Reflection

## Tomorrow's Priority
```

### Project Brief

New project documentation:

```markdown
# Project: [Name]

## Overview

Brief description of the project.

## Goals

-

## Timeline

| Milestone | Date | Status |
| --------- | ---- | ------ |
| Kickoff   |      |        |
| MVP       |      |        |
| Launch    |      |        |

## Team

-

## Resources

-
```

### Other System Templates

- Weekly Review
- 1:1 Meeting Notes
- Bug Report
- Feature Request
- Decision Log

## Creating Custom Templates

### Save as Template

Turn any memo into a template:

1. Create a memo with your desired structure
2. Open the page menu (three dots)
3. Select "Save as template"
4. Enter a name and category
5. Template appears in your Custom section

### Template Content

Templates can include:

- Formatted text and headings
- Lists and checkboxes
- Tables
- Code blocks
- Images (embedded)

## Variables

Templates support variable substitution:

### Available Variables

| Variable       | Replaced With            |
| -------------- | ------------------------ |
| `{{date}}`     | Current date (formatted) |
| `{{time}}`     | Current time             |
| `{{notebook}}` | Notebook name            |
| `{{user}}`     | Your display name        |

### Variable Example

```markdown
# Meeting Notes - {{date}}

Notebook: {{notebook}}
Author: {{user}}
```

Becomes:

```markdown
# Meeting Notes - January 31, 2026

Notebook: Team Alpha
Author: Sarah Chen
```

## Managing Templates

### Edit Template

1. Open the template gallery
2. Click the edit icon on your template
3. Modify the content
4. Save changes

### Delete Template

1. Open the template gallery
2. Click the delete icon on your template
3. Confirm deletion

_Note: System templates cannot be deleted, only custom templates._

### Share Templates

Templates are personal by default. To share:

1. Create a memo with the template content
2. Share the notebook containing it
3. Team members can save it as their own template

## Keyboard Shortcuts

| Action            | Shortcut               |
| ----------------- | ---------------------- |
| New from template | From **+** menu        |
| Quick template    | `Cmd/Ctrl + Shift + T` |

## Tips & Best Practices

### Effective Templates

- Include structure, not just placeholders
- Add instructions in comments: `<!-- Fill in your goals -->`
- Test the template before saving

### Template Strategy

- Create templates for recurring meetings
- Build templates for your workflow
- Share team templates via shared notebooks

### Maintenance

- Review and update templates periodically
- Remove unused templates
- Iterate based on actual usage

## Related Documentation

- [Memo Editor](./feature-memo-editor.md) - Creating content
- [Notebooks](./feature-notebooks.md) - Organizing templates
- [Engineering: Templates](./eng-templates.md) - Technical implementation
