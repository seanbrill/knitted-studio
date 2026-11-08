---
title: Using your model
order: 12
summary: Ask your model in the studio, or connect Claude or another model, so it can read Patterns, fill free slots and knit.
status: shipped
---
# Using your model

Your model gets the same set of tools wherever you talk to it: in the studio itself, with **Ask**, or from Claude Code or another app that speaks MCP. With them it reads Patterns, fills free slots, knits, and more.

## Ask, in the studio

Add your own Anthropic key in Settings, Model, and your model answers you inside knitted, as a conversation. Open **Ask** in the side bar, or **Ask your model** on a project's page.

- Choose where it works: one of your projects, or **The whole studio**. A chat about a project knows its brand.
- Write what you want and press Enter. Shift+Enter starts a new line. While it works you see each step: what it reads, what it changes, and anything a lock refused. **Stop** ends it.
- Reply to go on. It reads the whole conversation each time, so "make it shorter" means what you think it means.
- Write while it works and Enter, or **Queue it**, adds your message to a queue. It goes when the answer is in. You can take one out of the queue before then.
- Under each answer is what it changed, with a link to each Pattern. **Undo all** puts back every Pattern that answer changed. A Pattern it made stays, for you to keep or delete.
- Your chats are listed on the left, newest first. Deleting one deletes the conversation only: what your model made stays, and so does each Pattern's history.

In the editor, the **Ask** panel is a conversation about the Pattern in front of you. Tick **Suggest only** and it works on a copy, so your Pattern is untouched until you choose. **Open in Ask** shows the same chat on the Ask page.

To change one thing, choose **Ask your model...** in a Pattern's menu, or **Ask your model** on a file in Yarn or a knit. Say what should change, and your model does it in a chat of its own while you keep working.

Each message is paid for on your key, and the whole conversation goes with it. A long chat costs more a message than a new one, so start a new chat when you change the subject. **Settings, Spending** shows what the answers have cost this month, by model, and sets a **Monthly limit, in dollars** and a **Limit for one answer, in dollars**. At the monthly limit, your model waits until next month. In **Settings, Model**, **Steps per request** and **Files it may knit per request** set how far one request may go.

## Choose the model

Beside every message box, and in every **Ask your model** window, the **Model** menu says which model answers. It is the same choice as in **Settings, Model**, so picking it in one place changes it everywhere. Pick it while your model is working, and it takes your pick from its next step.

- **Auto** picks a model for each task, so a task costs no more than it needs. A quick change, like shorter words or a rename, starts on Claude Haiku 5.5, the cheapest. Layout, design sheets, drawing and motion start on Claude Opus 5.5. Everything else starts on Claude Sonnet 5.5.
- Part way through a task, Auto moves up a model if steps keep failing or the task turns out bigger than expected. It never moves down part way, since the model above can read what the one before it worked out, and the one below could not.
- On your next message it can move down again. The exception is a long chat answered in the last few minutes: that chat is still in the model's cache, and having another model read it all again would cost more than it saves.
- Or pick one model, and it answers everything: Claude Sonnet 5.5, Claude Opus 5.5, Claude Haiku 5.5 or Claude Fable 5.1, the most capable. Auto never picks Fable.

Each answer says which model gave it. In Auto, **What it did** says why it picked that model, and when and why it moved up. Captions for posts and a business's profile, which are written in one go, use Claude Sonnet 5.5 in Auto.

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
- "Read our brief and write three posts about what is new on the menu."
- "Take new pictures of our website, then design a fresh version of the home page's top section."

Or show it. Pin a comment to the spot on a knit or a design sheet that should change, and press **Ask your model to do this**. Your model reads comments with `list_comments`, looks at the spot with `view_comment`, and answers with `reply_comment`, resolving the comment when the change is made. See [Comments on a knit](/docs/batch-knitting/#comments) and [on a design](/docs/designs/#comments).

## Watch it work

While your model works, the studio shows it: its name and what it is doing, in the side bar on every page and in the editor's top bar. Open it to see a list of what it did, with anything that was refused and why.

Whatever it is working on is outlined in red, with its name and what it is doing, so you can see where it is and keep out of its way:

- in the editor, each Stitch it changes
- in a project, the Pattern, Yarn, Part, Swatch or design sheet in its list, and the tab it is under, such as **Patterns**
- on a design sheet, each frame it designs or looks at
- in the knitting queue, the batch it started

In the editor, a small bubble over the canvas shows what your model is thinking and doing as it happens, even with the chat closed. Shrink it to a dot, or close it for the rest of that run.

- **Follow** takes you where it is working, and keeps up as it moves from one Pattern to the next, or from frame to frame on a design sheet, bringing each into view. It stops when you go somewhere yourself or make a change of your own.
- **Pause** holds it. Until you press **Resume**, every change it tries is refused and it is told to wait for you. It can still read, check and preview.

You and your model can work on the same Pattern at once. Its changes appear on your canvas as it makes them, and **Undo** only takes back your own. If you were changing something when its change arrived, yours is kept too, unless you both changed the very same thing at the same moment. Then its change stays, and the studio tells you yours was not kept.

## When it is done

When a run you started in the studio ends, the studio tells you on whatever page you are on, with the first line of its answer and **Open the chat**. It says so too if your model stopped or could not finish. If knitted is behind another window, your computer shows a notification as well; the first time, it asks whether it may.

You are not told about a run in a chat you are watching, since you can see it end. To turn either kind off, open **Settings**, then **Model**, and look under *When your model finishes*.

A model connected from outside, such as Claude Code, is outlined as it works like any other, but the studio cannot tell when its task is over, so it is not announced.

## What it cannot do

It cannot change a locked Stitch. If it tries, knitted refuses and tells your model which slot was refused and why. Your model will tell you, so nobody thinks a change happened when it did not. Only a person unlocks a Stitch, in the studio.

It has no way to delete a project, a Pattern or Yarn, or to change a Swatch's colours. It can propose a new Swatch, for you to choose in the Swatch tab. Unless you let it in Settings, Social, the posts it makes are drafts. See [Posting to social accounts](/docs/social/).

## Keys and privacy

The studio's own model uses a key you bring, in Settings, Model. Claude Code and other apps use their own. Text you send to a model goes to that model's provider. Nothing else leaves your computer.
