# Bot Integrations

Bots extend Just Maple with automated capabilities. Trigger them with mentions, and they respond with AI-powered answers, data lookups, or custom actions.

## Understanding Bots

### What Are Bots?

Bots are automated assistants that:

- Respond when mentioned (`@botname`)
- Perform actions based on context
- Can access document content and chat history
- Return formatted responses

### Bot Types

- **System Bots** - Pre-built templates (e.g., Claude AI)
- **User Bots** - Custom bots you configure
- **Notebook Bots** - Bots shared with specific notebooks

## Using Bots

### Mentioning Bots

Trigger a bot by mentioning it:

```
@claude-bot What are the key points from this document?
@summarizer Please summarize the last 10 messages
@translator Translate this to Spanish
```

### Where Bots Work

Bots can be invoked in:

- **Chat messages** - Ask questions, get responses
- **Documents** - Inline AI assistance
- **Comments** - Respond to feedback

### Bot Responses

Responses appear in-context:

- Chat: As a threaded reply
- Documents: Inserted or as suggestion
- Can include formatted text, tables, code

## Bot Templates

### Available Templates

| Template        | Purpose                        |
| --------------- | ------------------------------ |
| **Claude AI**   | General-purpose AI assistant   |
| **Summarizer**  | Summarize documents or threads |
| **Translator**  | Multi-language translation     |
| **Code Helper** | Programming assistance         |
| **Custom**      | Build your own                 |

### Template Configuration

Each template may require:

- API keys (for external services)
- Custom prompts
- Output formatting preferences

## Creating User Bots

### Register a New Bot

1. Go to Settings > Bots
2. Click "Create Bot"
3. Choose a template or start from scratch
4. Configure the bot settings

### Configuration Options

| Setting           | Description                           |
| ----------------- | ------------------------------------- |
| **Name**          | Display name (e.g., "Team Claude")    |
| **Handle**        | Mention handle (e.g., `@team-claude`) |
| **Template**      | Base template to use                  |
| **API Key**       | External service credentials          |
| **System Prompt** | Custom instructions                   |
| **Model**         | AI model selection                    |

### Custom System Prompts

Define how the bot behaves:

```
You are a helpful assistant for the marketing team.
Always maintain brand voice guidelines.
Format responses with bullet points when listing items.
```

## Sharing Bots

### Adding to Notebooks

1. Open notebook settings
2. Go to "Bots" section
3. Select bots to enable
4. All notebook members can now use them

### Permission Levels

- **Personal** - Only you can use
- **Notebook** - All notebook members
- **Organization** - Everyone in your org

## Bot Input Context

### What Bots Can Access

When invoked, bots receive:

- The triggering message/selection
- Surrounding context (configurable)
- Document content (if applicable)
- User information

### Context Options

Configure what context to include:

- **Full document** - Entire page content
- **Selection only** - Just the selected text
- **Recent messages** - Last N chat messages
- **Thread** - Current thread context

## Bot Actions

### Types of Actions

Bots can perform:

- **LLM Calls** - AI model requests
- **HTTP Requests** - Call external APIs
- **Data Transforms** - Process and format data
- **Chained Actions** - Multiple steps

### Output Rendering

Responses can include:

- Markdown formatting
- Tables and lists
- Code blocks with highlighting
- Links and references

## Invocation Tracking

### View Bot Activity

Monitor bot usage:

1. Go to Settings > Bots
2. Select a bot
3. View "Invocation History"

### Tracked Information

- When invoked
- Who invoked
- Input context
- Response output
- Execution time
- Errors (if any)

## Best Practices

### Effective Bot Design

- Give clear, specific system prompts
- Test with various inputs
- Handle edge cases gracefully
- Keep responses concise

### Bot Naming

- Use descriptive names
- Keep handles short (`@helper` not `@my-helpful-assistant`)
- Avoid conflicts with user names

### Security Considerations

- Store API keys securely
- Limit sensitive data access
- Review bot permissions regularly
- Audit invocation logs

## Troubleshooting

### Bot Not Responding

- Check if bot is enabled in notebook
- Verify mention syntax (`@botname`)
- Review bot configuration
- Check API key validity

### Unexpected Responses

- Review system prompt
- Check input context settings
- Try regenerating
- Adjust model parameters

## Related Documentation

- [Chat & Messaging](./feature-chat.md) - Using bots in chat
- [AI Writing Assistant](./feature-ai-writing.md) - AI writing features
- [Notebooks](./feature-notebooks.md) - Sharing bots
- [Engineering: Bots](./eng-bots.md) - Technical implementation
