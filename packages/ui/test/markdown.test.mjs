// Markdown, as a model writes it, read into safe React: what it means is drawn, and nothing in
// it can run, load something, or link anywhere but the web and email.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// The component is TSX, which Node does not read: compiled here, the way the studio's bundler does.
const src = fileURLToPath(new URL("../src/markdown.tsx", import.meta.url));
const require = createRequire(import.meta.url);
const ts = require("typescript");
const abs = (s) => pathToFileURL(require.resolve(s)).href;
const js = ts.transpileModule(readFileSync(src, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace(/from "react\/jsx-runtime"/g, `from "${abs("react/jsx-runtime")}"`)
  .replace(/from "react"/g, `from "${abs("react")}"`)
  .replace(/from "\.\/cx\.ts"/g, `from "${new URL("../src/cx.ts", import.meta.url).href}"`);
const { Markdown } = await import("data:text/javascript," + encodeURIComponent(js));
const React = await import(abs("react"));
const { renderToStaticMarkup } = await import(abs("react-dom/server"));
const md = (text, props = {}) => renderToStaticMarkup(React.createElement(Markdown, { text, ...props })).replace(/^<div class="md">|<\/div>$/g, "");

test("emphasis, code and line breaks", () => {
  assert.equal(md("Hello **world**, *you*, `x < y` and ~~gone~~.\nNext line."), "<p>Hello <strong>world</strong>, <em>you</em>, <code>x &lt; y</code> and <del>gone</del>.<br/>Next line.</p>");
  assert.equal(md("snake_case_name and __strong__ and ***both***"), "<p>snake_case_name and <strong>strong</strong> and <strong><em>both</em></strong></p>");
  assert.equal(md("2 * 3 = 6, and **unclosed"), "<p>2 * 3 = 6, and **unclosed</p>");
  assert.equal(md("\\*not em\\* and \\`not code\\`"), "<p>*not em* and `not code`</p>");
});

test("headings sit under the page's own, and lists go in lists", () => {
  assert.equal(md("# Who it is for\n## Voice"), "<h3>Who it is for</h3><h4>Voice</h4>");
  assert.equal(md("# Top", { topLevel: 2 }), "<h2>Top</h2>");
  assert.equal(md("- a\n- b\n  - inner *x*\n- c\n\n3. three\n4. four"), "<ul><li>a</li><li>b<ul><li>inner <em>x</em></li></ul></li><li>c</li></ul><ol start=\"3\"><li>three</li><li>four</li></ol>");
  assert.equal(md("Text\n- right after\n- two"), "<p>Text</p><ul><li>right after</li><li>two</li></ul>");
  assert.equal(md("- one\n\n- two\n\n  more of two"), "<ul><li><p>one</p></li><li><p>two</p><p>more of two</p></li></ul>");
});

test("code blocks, quotes, rules and tables", () => {
  assert.equal(md("```js\nif (a < b) {}\n```"), "<pre data-lang=\"js\"><code>if (a &lt; b) {}</code></pre>");
  assert.equal(md("> said **this**\n> and that\n\n---"), "<blockquote><p>said <strong>this</strong><br/>and that</p></blockquote><hr/>");
  assert.equal(md("| Size | px |\n|:--|--:|\n| Post | `1080|1080` |"), "<table><thead><tr><th style=\"text-align:left\">Size</th><th style=\"text-align:right\">px</th></tr></thead><tbody><tr><td style=\"text-align:left\">Post</td><td style=\"text-align:right\"><code>1080|1080</code></td></tr></tbody></table>");
});

test("HTML is words, never markup, and pictures are not fetched", () => {
  const out = md("<script>alert(1)</script> <img src=x onerror=alert(1)> ![logo](https://example.com/logo.png)");
  assert.ok(!/<script|<img/.test(out), out);
  assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(out, /<a href="https:\/\/example.com\/logo.png" target="_blank" rel="noreferrer">logo<\/a>/);
});

test("links go to the web or to email, open outside, and anything else is only its words", () => {
  assert.equal(md("[site](https://knitted.studio) and [mail](mailto:hi@example.com)"), "<p><a href=\"https://knitted.studio\" target=\"_blank\" rel=\"noreferrer\">site</a> and <a href=\"mailto:hi@example.com\" target=\"_blank\" rel=\"noreferrer\">mail</a></p>");
  assert.equal(md("[bad](javascript:alert(1)) [worse](data:text/html,x) [file](file:///etc/passwd)"), "<p>bad worse file</p>");
  assert.equal(md("see https://example.com/a_(b). and www.example.org, <https://x.test/y>"), "<p>see <a href=\"https://example.com/a_(b)\" target=\"_blank\" rel=\"noreferrer\">https://example.com/a_(b)</a>. and <a href=\"https://www.example.org\" target=\"_blank\" rel=\"noreferrer\">www.example.org</a>, <a href=\"https://x.test/y\" target=\"_blank\" rel=\"noreferrer\">https://x.test/y</a></p>");
});
