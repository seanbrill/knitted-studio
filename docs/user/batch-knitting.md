---
title: Batch knitting
order: 8
summary: Knit a dozen posts from one Pattern in one go.
status: shipped
---
# Batch knitting

Once a Pattern is set, producing many posts is the easy part. Knit as many as you like, in as many sizes as you need.

## The Knit dialog

Press **Knit** in the editor's top bar. The dialog has:

- **Format**: PNG, JPEG or WebP for a still. A Pattern with motion knits as an **MP4 video**.
- **Quality**: **1x**, or **2x sharper**.
- **Smoothness**, for a video: **30 fps**, or **60 fps** for fast motion, which takes about twice as long. A video whose footage was all shot at 24 or 25 fps is made at that rate.
- **Sizes**: pick one or several, and the same Pattern is knitted at each.
- **Reuse identical knits**: if nothing changed, a file is not drawn again.

Under **Checks**, the dialog looks the Pattern over before you knit. A **Heads up** is worth reading. A **Fix this first**, like a slot whose Yarn was deleted, has to be fixed before you can knit. The button says how many files you will get, like **Knit 3 files**.

## Many posts from a table

Turn on **Knit many from a table**. Each row of the table is one post.

1. Press **Start with this pattern's slots**. The first line becomes the column names: the Pattern's free slots.
2. Add a line for each post. Paste from a spreadsheet, or type with a tab or a comma between the cells.
3. For a text slot, write the text. For a picture or video slot, write a Yarn name, or `tag:product` to take turns through the files with that tag, one per row.
4. Press the **Knit** button.

```
headline,photo
Spring sale,Hero shot
New arrivals,tag:product
Last chance,tag:product
```

Every row is knitted at every size you picked, so three rows at two sizes make six files.

A row fills only free slots. A column for a locked slot, or a Yarn name that matches no file, has to be fixed before you knit. A column that is not a slot is left out, with a heads up.

## While it knits

The dialog shows how far it has got, and **Cancel** stops it. What was already done is kept. Knits take turns, one at a time. The project's pages show the knit under way and how many are waiting, and the **Knits** tab lists them, each to cancel, or **Cancel all**.

Files knitted together are grouped in the project's **Knits** tab, as a batch. **Download batch** gives you a zip of them.

## Finding a knit

The **Knits** tab searches by name. It can also narrow to **Pictures** or **Videos**, to a size, a format or a tag, to **Only new**, or to **Only favourites**. A size is a shape, at any scale:

- **Story**, 9:16, is what Stories, Reels, TikTok and Shorts take. A reel is a Story-shaped video.
- **Post** is 4:5, **Square** 1:1, and **Landscape** 16:9, for YouTube.
- **Banner** is the link card, and **Other sizes** is anything else.

Press the star on a knit, or **Favourite** when it is open, to mark one you like. Pick several to star them together. Your model sees your favourites too (`list_knits` with `favorite`): the surest guide to what you want more of.

## Comments

Open a knit and press **Add a comment**, click the spot that should change, and say what. In a video, find the moment with the controls first: the comment is at that moment, and its pin shows round then. For a comment with no spot, choose **the whole knit** (or **this moment**, in a video) instead of clicking.

Each comment is numbered, and its pin has the same number. Open a comment to reply, **Resolve** it or delete it. **Resolved** shows the resolved ones again, and **Open again** brings one back. A knit's card shows how many of its comments are open.

**Ask your model to do this** on a comment, or **Ask your model to do all** for every open one, and your model does what they say. It sees the knit with the pin on it and a close-up of the spot, and which stitch of the pattern is under the pin. It changes the pattern, knits it again, and answers each comment, resolving it when it is done. A knit is a finished file, so the change is a new knit; the old one keeps its comments.

## Through your model

Your model knits with `knit_pattern`. Its `rows` are the same table, one set of slot values per post, and `sizes` the same sizes. Ask for twelve and you get twelve files in the project's Knits. When you ask in the studio, **Files it may knit per request**, in Settings, Model, sets how many one request may make.

## Needs

The desktop app has what it needs: it carries ffmpeg, and downloads the browser it draws with by itself the first time it starts. Running from a clone, install Playwright's Chromium and ffmpeg yourself ([Quick start](/docs/quick-start/) shows how). See [Troubleshooting](/docs/troubleshooting/) if knitting will not start.
