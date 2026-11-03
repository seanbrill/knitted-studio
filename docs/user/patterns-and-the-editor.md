---
title: Patterns and the editor
order: 6
summary: Lay out stitches, lock the ones that carry the brand, and leave the rest free.
status: soon
note: The editor is a shell today. It shows the layout and the locked and free outlines but does not edit yet.
---
# Patterns and the editor

A Pattern is a reusable layout. You build it once in the editor, then knit it as often as you like.

## The canvas

The canvas is in the middle, with your tools on the left and the details of the selected Stitch on the right. A prompt bar floats at the bottom for asking your model for changes.

## Locking

Select a Stitch and lock it if it carries the brand: the logo, the colours, the type. Locked Stitches get a dashed orange outline. Free Stitches get a plain solid outline.

## Slots

Each Stitch can have a slot name, such as `headline` or `photo`. Slots are how people and models fill a Pattern without touching the layout. Names stay put when the layout changes.

## Sizes

A Pattern is not tied to one size. Positions are stored as fractions of the frame, so the same Pattern can be knitted as a Story, a square or a wide ad.
