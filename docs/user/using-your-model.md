---
title: Using your model
order: 12
summary: Connect Claude or another model so it can read Patterns, fill free slots and knit.
status: partial
note: Your model works in the studio through its MCP address (desktop app) or the stdio server (a clone).
---
# Using your model

Your model can do what you can do in the studio, through the same tools.

## Connect it

**From the desktop app.** Open Settings, Model, and copy the command under **Connect Claude Code**. Run it in a terminal, then start Claude Code: it adds knitted to Claude Code for every folder you work in. Or paste the command into Claude Code and ask it to connect. Other apps that speak MCP over HTTP take the address underneath it. It works while knitted is open. The address holds a key, so keep it to yourself; **Make a new address** shuts the old one.

**From a clone of the repository.** Add the stdio server to your model's MCP settings, using the path to your clone:

{{mcp-config}}

Then restart your model's app so it picks up the new tools.

## What to ask

- "List my projects."
- "Show me the launch story Pattern. Which Stitches are locked?"
- "Fill the headline with something short about our spring sale."
- "Knit six of those."

## Watch it work

While your model works, the studio shows it: its name and what it is doing, in the side bar on every page and in the editor's top bar. In the editor, each Stitch it changes is outlined in red with its name for a moment, so you can see where it is working and keep out of its way. Open it to see a list of what it did, with anything that was refused and why.

- **Follow** takes you where it is working, and keeps up as it moves from one Pattern to the next. It stops when you go somewhere yourself or make a change of your own.
- **Pause** holds it. Until you press **Resume**, every change it tries is refused and it is told to wait for you. It can still read, check and preview.

You and your model can work on the same Pattern at once. Its changes appear on your canvas as it makes them, and **Undo** only takes back your own. If you were changing something when its change arrived, yours is kept too, unless you both changed the very same thing at the same moment. Then its change stays, and the studio tells you yours was not kept.

## What it cannot do

It cannot change a locked Stitch. If it tries, knitted refuses and tells your model which slot was refused and why. Your model will tell you, so nobody thinks a change happened when it did not. Only a person unlocks a Stitch, in the studio.

## Keys and privacy

The studio's own model uses a key you bring, in Settings, Model. Claude Code and other apps use their own. Text you send to a model goes to that model's provider. Nothing else leaves your computer.
