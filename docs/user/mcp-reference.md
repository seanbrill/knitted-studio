---
title: MCP reference
order: 13
summary: Every tool the MCP server offers, with its parameters.
status: shipped
---
# MCP reference

This page is built from the server's own list of tools, the same one the [MCP page](/mcp/) shows, so it cannot drift from the server. The desktop app serves them over HTTP, at the address in Settings, Model. From a clone, the server speaks MCP over stdio: run it with `npm run mcp`. See [Using your model](/docs/using-your-model/) to connect either. The server's answer to `initialize` names the version of knitted it is (`serverInfo.version`), so a client can tell which build it is talking to, and `tools/list` marks the tools that only read with `readOnlyHint`. `get_studio_info` says the same version, when the running build was made and when it started: when the app on the computer was built after that, an older copy is still running, and quitting knitted and opening it again starts the new one.

{{mcp-tools}}

## Errors

A tool that cannot do its job replies with a plain message saying what happened and what to do. For example, `preview_pattern` waits while the desktop app downloads its browser, and if the download fails it says why, and that `check_pattern` works without it. While the person has paused models in the studio, a tool that changes something replies that it is paused; the tools that only read still work.
