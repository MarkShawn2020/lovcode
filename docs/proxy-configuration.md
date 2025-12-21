# Proxy configuration options

Lovcode surfaces the same configuration files that Claude Code reads (`~/.claude/settings.json`). You can choose one of the following proxy setups depending on whether you want to call Anthropic directly or route traffic through a provider such as ZenMux. Replace the placeholder API keys before using.

## 1) Native Anthropic (direct)

Use the official Anthropic endpoint with your Anthropic API key.

```json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-xxxxx",
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-3-5-haiku-20241022",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-3-7-sonnet-20250219",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-3-opus-20240229"
  }
}
```

## 2) ZenMux Anthropic proxy

Route Anthropic-protocol requests through ZenMux (see `Claude Code CLI Guide via ZenMux - ZenMux.md`). This unlocks additional model slugs exposed by ZenMux.

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-ai-v1-xxxxx",
    "ANTHROPIC_BASE_URL": "https://zenmux.ai/api/anthropic",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "anthropic/claude-haiku-4.5",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "anthropic/claude-sonnet-4.5",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "anthropic/claude-opus-4.5"
  }
}
```

## 3) Corporate HTTP(S) proxy

If your network requires outbound HTTP(S) proxies, add the standard environment variables alongside either of the above blocks.

```json
{
  "env": {
    "HTTP_PROXY": "http://proxy.company.com:8080",
    "HTTPS_PROXY": "https://proxy.company.com:8080"
  }
}
```

### Applying a preset

1. Create or edit `~/.claude/settings.json`.
2. Pick one of the proxy blocks above (native or ZenMux), optionally merge with the corporate proxy block.
3. Restart Claude Code and verify with `/model` to confirm the active model and endpoint.
