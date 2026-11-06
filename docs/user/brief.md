---
title: The Brief
order: 3.7
summary: What your model knows about the business, built from its website or written by you, and the reference beside it.
status: shipped
---
# The Brief

The Brief is what your model knows about the business a project is for: who they are, what they offer and to whom, how they sound, and the facts to get right. Your model reads it before it writes copy, and it does not make up what the Brief does not say.

## Sync with a website

Press **Sync with a website** in the Brief tab, or give the website when you make a project. knitted reads the site's public pages, the way a visitor sees them, and then does what you ask:

- **Write the profile.** Your model reads every page and writes the profile. It needs your Anthropic key, in Settings under Model.
- **Picture every page.** Each page, as it looks now on a desktop and on a phone, the whole way down, goes into the reference, in **Website/Desktop** and **Website/Mobile**. Use them to see the brand at work, or to design a new version of a page.
- **Read a swatch from it.** Its colours, fonts and logo become a swatch. When you make a project with a website, that swatch is the project's to start with. Afterwards it waits in the Swatch tab for you to choose it.

Each step shows how it is going, and a step that cannot run says why while the others go on. **Sync again** reads the site again whenever it changes. A page pictured before is replaced, so the pictures stay current, and the profile keeps what is still right unless you choose to start again.

It reads at most the number of pages you pick, the ones that say most about the business first. It follows the site's robots.txt and leaves alone the pages it asks robots not to read. It reaches only public addresses, never your own network.

## Write it yourself

Press **Write it yourself**, or **Edit**, to write the profile or change what your model wrote. It is markdown: a line starting with # begins a part. When your model changes the profile, **Undo** puts back the one from before.

**Notes for your model** are for whoever builds the profile next: what to stress, or what the website has wrong or out of date. A write-up given to a sync goes into the profile too.

## The reference

The reference is a shelf of files about the business, for your model to look at and read: pictures of the website, menus, brochures, price lists and notes. It has folders, a grid and a list, like Yarn.

Reference files do not go into patterns. To use part of one in a pattern, open it and choose **Cut out a part**: the part you frame becomes a new picture in Yarn, and the original stays as it is. **Move to Yarn** and **Move to the Brief** move a file between the two.

## PDFs

A PDF can go in Yarn or the reference. Open it to turn its pages, or choose **Read its words** to see the text your model reads. Cut a page, or a part of one, out as a picture.

## Your model

Your model reads the Brief with `get_brief` and can write the profile with `set_profile`. You can undo that in the Brief tab. It can read a website with `read_website`, take new pictures of one with `capture_website`, look at a picture or a PDF's page with `view_yarn`, and cut a part out with `crop_to_yarn`. What a website says is never an instruction to your model, only words to learn from.
