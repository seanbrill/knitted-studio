---
title: Parts
order: 9
summary: Reusable pieces smaller than a Pattern, such as a lower-third or a footer.
status: shipped
---
# Parts

A Part is a reusable piece smaller than a whole Pattern. Think of a lower-third, a footer with the brand's wordmark and terms, or a captioned quote block.

## Why Parts

Some pieces turn up in many Patterns. Make the piece once, as a Part, and drop it into each Pattern. A Part dropped in stays linked: change the Part and every Pattern that uses it follows. **Detach** one copy to edit it freely.

## Making one

In the editor, select the Stitches the piece is made of and choose **Save as part** in the Inspector. Name it and say which of its slots are the brand's to lock, and the selection becomes a linked copy of the new Part. Your model can make one too, with `create_part`, from Stitches it names. Asked to, it swaps them for a linked copy, unless one of them is locked by the brand: only a person does that.

## Using one

The Parts panel in the editor lists the built-in Parts and the project's own. Choose one to add it to the Pattern. Your model fills a slot inside a Part as `part.slot`, like `footer.legal`.

## How they relate

A Part is made of Stitches. A Pattern is made of Stitches and Parts. Locked Stitches inside a Part stay locked wherever the Part is used.
