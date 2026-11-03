---
title: MCP reference
order: 13
summary: Every tool the MCP server offers, with its parameters.
status: shipped
---
# MCP reference

This page is built from the server's own list of tools, the same one the [MCP page](/mcp/) shows, so it cannot drift from the server. The desktop app serves them over HTTP, at the address in Settings, Model. From a clone, the server speaks MCP over stdio: run it with `npm run mcp`. See [Using your model](/docs/using-your-model/) to connect either.

{{mcp-tools}}

## Errors

A tool that cannot do its job replies with a plain message saying what happened. For example, `knit_pattern` explains how to install Playwright if it is missing.
