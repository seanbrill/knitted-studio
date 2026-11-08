---
title: Fill mode
order: 7
summary: Change only the free stitches, then knit. No design skills needed.
status: shipped
---
# Fill mode

Fill mode is for using a Pattern someone else built, or one you built last month. You see the Pattern, change its free slots and knit.

## Turning it on

Open the Pattern and pick **Fill** in the **Mode** switch in the top bar. **Pattern** takes you back to the layout.

## What you can change

In Fill mode the Inspector becomes a form headed **What changes each time**. It lists the Pattern's free slots, and nothing else:

- A text slot is a box to type in. What you type is saved when you leave the box.
- A picture or video slot is a menu of your Yarn, **Choose from Yarn**.

Locked Stitches are not in the form, and on the canvas they do not respond. You cannot select one, from the canvas or from Layers, and its lock cannot be turned off. You cannot break the brand by accident. A line above the form says how many are locked.

Free Stitches still work on the canvas as they do in Pattern mode.

A free Stitch with no slot name is not in the form. To make one fillable, switch to Pattern mode and give it a slot name in the Inspector. The slots of a Part are filled in Pattern mode too, in the Inspector.

## Fill changes the Pattern

What you fill is saved to the Pattern itself, like any change in the editor. **Undo** takes it back, and **History** lists it. To keep a Pattern as it is, choose **Duplicate** in its menu in the Patterns tab, and fill the copy.

## Then knit

Press **Knit** in the top bar. To make many posts at once, each with its own words and pictures, turn on **Knit many from a table** in the Knit dialog instead of filling one at a time. See [Batch knitting](/docs/batch-knitting/).

## Through your model

Your model fills the same free slots, with `fill_slots`. It writes by slot name: a text slot takes text, and a picture or video slot takes a Yarn name, or `tag:product` for the first file with that tag. A slot inside a Part is `part.slot`. Anything locked is refused and reported back. See [Using your model](/docs/using-your-model/).
