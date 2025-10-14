import { describe, expect, it } from "vitest";

import { formatPlaintextAsHtml } from "./detail-shared";

describe("formatPlaintextAsHtml", () => {
  it("renders inline code blocks", () => {
    const html = formatPlaintextAsHtml("hello `code` world");
    expect(html).toBe("<p>hello <code>code</code> world</p>");
  });

  it("renders fenced code blocks", () => {
    const html = formatPlaintextAsHtml("```\nconst a = 1;\n```");
    expect(html).toBe("<pre><code>const a = 1;</code></pre>");
  });

  it("adds language class for fenced code blocks", () => {
    const html = formatPlaintextAsHtml("```json\n{}\n```");
    expect(html).toBe('<pre><code class="language-json">{}</code></pre>');
  });

  it("highlights user mentions outside code", () => {
    const html = formatPlaintextAsHtml("@user said `@not-highlighted`");
    expect(html).toBe(
      '<p><span class="user-mention">@user</span> said <code>@not-highlighted</code></p>',
    );
  });

  it("supports multiple paragraphs", () => {
    const html = formatPlaintextAsHtml("first paragraph\n\nsecond one");
    expect(html).toBe("<p>first paragraph</p><p>second one</p>");
  });
});
