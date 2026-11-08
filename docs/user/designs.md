---
title: Design sheets
order: 9.5
summary: A whole site's design on one board, like a Figma file, in labelled sections and in your brand.
status: shipped
---
# Design sheets

A design sheet is a whole site on one board: its colours and type, the pieces every page shares, and each page on a computer and a phone, in labelled sections. You can design one yourself or with your model. Open a project's **Designs** tab to see its sheets.

## Starting one

Choose **New design**, name it, and choose how it starts:

- **From your brand** starts with three sections. **Foundations** shows your colours, type, buttons and fields. **Components** has a header and a footer. **Pages** has a home page on a computer and on a phone. It is all drawn with your Swatch, so start by making the words your own.
- **Blank** starts with one empty section.

Or choose **Design with your model** and say what you want, like *our whole site: home, about, pricing and contact*. Your model designs it in a chat of its own while you carry on. You can watch the board change as it saves each frame.

## The board

- Each section has a name, and can have a note beside it. Use **Add a section** for one of your own, such as *Shop* or *Checkout*. A section's menu renames it, moves it up or down, downloads it (as a picture, as code, or everything in it with a style guide), or deletes it.
- A frame is a page, a screen or a piece of one, at a width: **Desktop** 1440, **Tablet** 834, **Mobile** 390, or one of your own. A frame is as tall as what is in it, unless you give it a fixed height, such as one phone screen.
- **Fit** shows the widest section across the window. Zoom in as far as 400% to read the detail. Pinch, or hold Ctrl and scroll, to zoom about the pointer, or use the zoom menu. The labels stay the same size at any zoom.
- Double-click a frame to zoom to it, whole and in the middle. Double-click the space between frames to fit again.
- Scroll to move about the board, or drag the space between frames. Hold Space, or turn on the **Hand** (press H), to drag over the frames too. The keys are the editor's: Shift+1 fits, Shift+2 zooms to the selected frame, and Shift+0 is 100%.
- **Undo** takes back the last change to the sheet, whether you made it or your model did. Press it again to go further back.

## Changing a frame

Select a frame to open it beside the board. You can change its name, width, height and note, and the HTML and CSS it is written in. What you type shows on the board a moment later. **Save** keeps it (or press Ctrl+S), and **Discard** goes back to what was saved. A frame keeps what you have not saved while you look at another: open it again and your changes are still there.

- Colours, fonts and corners come from the Swatch as CSS variables, like `var(--color-primary)`, `var(--font-display)` and `var(--radius)`. Change the Swatch, and every frame follows.
- A picture from Yarn is `yarn:` and its id, like `<img src="yarn:yn_01..." alt="...">`. Your logo is `yarn:logo`.
- A design is a picture of a site: scripts do not run, and nothing loads from the web. Show each state as its own frame, such as *Menu, open*.
- **Make a copy**, **Picture**, **Delete** and the **Section** list work on the frame you have open.

## Taking it away

**Download** has three choices:

- **The sheet, as a picture**: a PNG of the whole board, with its labels. **Picture** on a frame downloads that frame at twice the size.
- **The code**: a ZIP with a page of HTML for each frame, filed by section. It also holds `tokens.css` with your brand, your fonts and the pictures the design uses. Open its `index.html` to see every page. A developer, or a model building the real site, can start from it.
- **Everything**: a ZIP with the sheet as a picture, each section as a picture, all of the code, the fonts and the pictures the design uses, and a style guide. A big sheet takes a moment to put together. The style guide comes as `style-guide.html` and as a picture of it, and shows what the design is drawn with:
  - the brand's colours, fonts and corners, each with the CSS variable the pages use, such as `var(--color-primary)`, and how often and where it is used
  - any colour written out in the code instead of through a variable, saying when it is one of the brand's, so you can see what is off-brand
  - every type size and weight, largest first, each drawn in the display font
  - the other corners, the spacing (padding, margins and gaps) and the shadows in the code

  `tokens.json` has the brand's colours, fonts, corners, type sizes and spacing as data, for a design tool or a build.

The list of design sheets has **Download the code** and **Download everything** in each sheet's menu too.

Each section downloads on its own from its menu, in the same three ways: **Download as a picture**, **Download its code**, and **Download everything, with a style guide**. Everything for a section is a ZIP named for the sheet and the section, such as `website-pages.zip`. It has `section.png`, that section's frames as code, the fonts and pictures they use, and a style guide of just what that section is drawn with.

## Your model

Your model uses `create_design`, `set_design_frame`, `arrange_design`, `get_design` and `view_design`. Each frame it designs is drawn back to it, so it checks its own work. Its frames are marked **by your model** on the board.

While it works, the frame it is designing or looking at is outlined in red on the board, with what it is doing, and a panel in the corner says the same. Press **Follow** there, and each frame it works on is brought into view.
