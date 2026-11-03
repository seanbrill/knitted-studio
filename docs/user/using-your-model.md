---
title: Using your model
order: 12
summary: Connect Claude or another model so it can read Patterns, fill free slots and knit.
status: partial
note: The four MCP tools work today. The model prompt bar inside the studio is not built yet.
---
# Using your model

Your model can do what you can do in the studio, through the same four tools.

## Connect it

Add the server to your model's MCP settings, using the path to your clone:

{{mcp-config}}

Then restart your model's app so it picks up the new tools.

## What to ask

- "List my projects."
- "Show me the launch story Pattern. Which Stitches are locked?"
- "Fill the headline with something short about our spring sale."
- "Knit six of those."

## What it cannot do

It cannot change a locked Stitch. If it tries, knitted refuses and tells your model which slot was refused and why. Your model will tell you, so nobody thinks a change happened when it did not. Only a person unlocks a Stitch, in the studio.

## Keys and privacy

When the in-app model arrives you will bring your own key. Text you send to a model goes to that model's provider. Nothing else leaves your computer.
