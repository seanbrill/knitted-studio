---
title: MCP reference
order: 13
summary: The four tools the MCP server offers, with their parameters and results.
status: shipped
---
# MCP reference

This page is built from the same typed list as the [MCP page](/mcp/), so it cannot drift from the server. The server speaks MCP over stdio. Run it with `npm run mcp` from the repository.

{{mcp-tools}}

## Errors

A tool that cannot do its job replies with a plain message saying what happened. For example, `knit_pattern` explains how to install Playwright if it is missing.
