(() => {
  const NON_CONTENT_TAGS = new Set([
    "script", "style", "noscript", "svg", "canvas", "iframe", "form", "button", "input", "textarea", "select", "option", "dialog", "template"
  ]);
  const BLOCK_TAGS = new Set(["article", "aside", "blockquote", "div", "figure", "figcaption", "main", "p", "section"]);
  const FALLBACK_NOISE_TAGS = new Set(["aside", "footer", "header", "nav"]);
  const NOISE_HINT = /(?:advert|banner|breadcrumb|cookie|consent|footer|header|menu|modal|nav|newsletter|pagination|promo|recommend|related|share|sidebar|social|subscribe|toolbar)/i;
  const ELEMENT_CHROME_HINT = /(?:cookie|consent|menu|pagination|share|social|subscribe|toolbar)/i;
  const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

  globalThis.__clipplaneDom = {
    captureFallback,
    findElementTarget,
    normalizeElement
  };

  function captureFallback(doc, sourceUrl) {
    const root = pickFallbackRoot(doc);
    return normalizeElement(root, { profile: "fallback", sourceUrl });
  }

  function normalizeElement(root, options = {}) {
    const profile = options.profile === "element" ? "element" : options.profile === "article" ? "article" : "fallback";
    const sourceUrl = options.sourceUrl || location.href;
    const lines = [];
    walk(root, lines, { profile, sourceUrl, listDepth: 0, isRoot: true });
    const markdown = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return { markdown, text: cleanText(markdown.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")) };
  }

  function findElementTarget(start) {
    let node = start instanceof Element ? start : null;
    while (node && node !== document.body) {
      if (isElementCandidate(node)) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function pickFallbackRoot(doc) {
    const body = doc.body || doc.documentElement;
    const selectors = ["article", "main", "[role='main']", "section", ".article", ".post", ".entry-content", ".content", "#content"];
    const candidates = [...new Set([
      ...selectors.flatMap((selector) => [...body.querySelectorAll(selector)]),
      body
    ])];
    candidates.sort((left, right) => scoreFallbackCandidate(right) - scoreFallbackCandidate(left));
    return candidates[0] || body;
  }

  function scoreFallbackCandidate(element) {
    if (!isVisible(element)) {
      return Number.NEGATIVE_INFINITY;
    }
    const text = elementText(element);
    if (text.length < 8) {
      return Number.NEGATIVE_INFINITY;
    }
    const paragraphs = element.querySelectorAll("p").length;
    const headings = element.querySelectorAll("h1, h2, h3, h4, h5, h6").length;
    const controls = element.querySelectorAll("button, input, select, textarea, [role='button'], [role='menuitem']").length;
    const linkDensity = textLength(element.querySelectorAll("a")) / Math.max(text.length, 1);
    const noisePenalty = hasNoiseHint(element) ? 900 : 0;
    const bodyPenalty = element === document.body ? 500 : 0;
    return text.length + paragraphs * 140 + headings * 60 - controls * 180 - linkDensity * text.length * 2 - noisePenalty - bodyPenalty;
  }

  function isElementCandidate(element) {
    const tag = element.tagName.toLowerCase();
    if (NON_CONTENT_TAGS.has(tag) || isHidden(element)) {
      return false;
    }
    const text = elementText(element);
    if (!text || text.length > 30_000) {
      return false;
    }
    return /^(article|blockquote|dd|div|figure|li|main|p|pre|section|td|tr)$/.test(tag)
      || ["article", "comment", "feed", "listitem", "main", "row"].includes(element.getAttribute("role"));
  }

  function walk(node, lines, context) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = cleanText(node.nodeValue);
      if (value && !isBoilerplateText(value)) {
        appendText(lines, value);
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || shouldDrop(node, context)) {
      return;
    }

    const tag = node.tagName.toLowerCase();
    if (tag === "br") {
      lines.push("");
      return;
    }
    if (/^h[1-6]$/.test(tag)) {
      const text = elementText(node);
      if (text && !isBoilerplateText(text)) {
        blank(lines);
        lines.push(`${"#".repeat(Number(tag.slice(1)))} ${text}`);
        blank(lines);
      }
      return;
    }
    if (tag === "pre") {
      const text = String(node.textContent || "").replace(/\n+$/g, "");
      if (text) {
        blank(lines);
        lines.push("```");
        lines.push(text);
        lines.push("```");
        blank(lines);
      }
      return;
    }
    if (tag === "li") {
      const before = lines.length;
      walkChildren(node, lines, context);
      const item = lines.splice(before).join(" ").trim();
      if (item) {
        lines.push(`${"  ".repeat(context.listDepth)}- ${item}`);
      }
      return;
    }
    if (tag === "ul" || tag === "ol") {
      blank(lines);
      for (const child of node.children) {
        walk(child, lines, { ...context, listDepth: context.listDepth + 1, isRoot: false });
      }
      blank(lines);
      return;
    }
    if (tag === "table") {
      appendTable(node, lines, context);
      return;
    }
    if (tag === "a") {
      const text = elementText(node);
      const href = safeLinkHref(node.getAttribute("href"), context.sourceUrl);
      if (text && !isBoilerplateText(text)) {
        appendText(lines, href ? `[${text}](${href})` : text);
      }
      return;
    }
    if (BLOCK_TAGS.has(tag)) {
      blank(lines);
      walkChildren(node, lines, { ...context, isRoot: false });
      blank(lines);
      return;
    }
    walkChildren(node, lines, { ...context, isRoot: false });
  }

  function walkChildren(node, lines, context) {
    for (const child of node.childNodes) {
      walk(child, lines, context);
    }
  }

  function appendTable(table, lines, context) {
    const rows = [...table.querySelectorAll("tr")]
      .map((row) => [...row.querySelectorAll("th, td")]
        .filter((cell) => !shouldDrop(cell, { ...context, isRoot: false }))
        .map((cell) => cleanText(cell.textContent).replaceAll("|", "\\|"))
        .filter(Boolean))
      .filter((cells) => cells.length);
    if (!rows.length) {
      return;
    }
    blank(lines);
    for (const row of rows) {
      lines.push(`| ${row.join(" | ")} |`);
    }
    blank(lines);
  }

  function shouldDrop(element, context) {
    const tag = element.tagName.toLowerCase();
    if (NON_CONTENT_TAGS.has(tag) || isHidden(element)) {
      return true;
    }
    const role = element.getAttribute("role");
    if (["button", "dialog", "menu", "menuitem", "navigation", "tab", "toolbar"].includes(role)) {
      return true;
    }
    if (context.profile === "element" && !context.isRoot && ELEMENT_CHROME_HINT.test(elementHint(element))) {
      return true;
    }
    if (context.profile === "fallback" && !context.isRoot) {
      if (FALLBACK_NOISE_TAGS.has(tag) || hasNoiseHint(element)) {
        return true;
      }
      const text = elementText(element);
      if (text.length >= 40 && linkDensity(element, text.length) > 0.65) {
        return true;
      }
    }
    return false;
  }

  function isHidden(element) {
    if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") {
      return true;
    }
    try {
      const style = getComputedStyle(element);
      return style.display === "none" || style.visibility === "hidden" || style.contentVisibility === "hidden";
    } catch {
      return false;
    }
  }

  function isVisible(element) {
    return !isHidden(element) && !FALLBACK_NOISE_TAGS.has(element.tagName.toLowerCase());
  }

  function hasNoiseHint(element) {
    return NOISE_HINT.test(elementHint(element));
  }

  function elementHint(element) {
    return [element.id, element.className, element.getAttribute("aria-label"), element.getAttribute("data-testid")]
      .filter((value) => typeof value === "string")
      .join(" ");
  }

  function linkDensity(element, totalLength) {
    return textLength(element.querySelectorAll("a")) / Math.max(totalLength, 1);
  }

  function textLength(elements) {
    return [...elements].reduce((total, element) => total + elementText(element).length, 0);
  }

  function safeLinkHref(value, sourceUrl) {
    try {
      const url = new URL(value, sourceUrl);
      return ALLOWED_PROTOCOLS.has(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function appendText(lines, text) {
    if (!lines.length || lines.at(-1) === "") {
      lines.push(text);
    } else {
      lines[lines.length - 1] += ` ${text}`;
    }
  }

  function blank(lines) {
    if (lines.length && lines.at(-1) !== "") {
      lines.push("");
    }
  }

  function elementText(element) {
    return cleanText(element?.innerText || element?.textContent);
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isBoilerplateText(text) {
    return /^To view keyboard shortcuts, press question mark\s*View keyboard shortcuts\.?$/i.test(cleanText(text));
  }
})();
