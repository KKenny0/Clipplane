const HOST_NAME = "com.clipplane.host";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "clipplane-selection",
    title: "Clip selection to Clipplane",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: "clipplane-page",
    title: "Clip page to Clipplane",
    contexts: ["page"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const mode = info.menuItemId === "clipplane-selection" ? "selection" : "page";
  clipTab(tab.id, mode).catch((error) => {
    chrome.storage.local.set({
      lastClipResult: {
        ok: false,
        error: { message: error.message }
      }
    });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (["status", "get_config", "set_config", "open_notes_dir"].includes(message?.type)) {
    sendNative(message).then(sendResponse);
    return true;
  }

  if (message?.type !== "clip") {
    return false;
  }

  chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
    if (!tab?.id) {
      throw new Error("No active tab found.");
    }
    return clipTab(tab.id, message.mode || "selection", Boolean(message.sync));
  }).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: { message: error.message } });
  });

  return true;
});

async function clipTab(tabId, mode, sync = false) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectPagePayload,
    args: [mode]
  });

  const response = await sendNative({
    type: "clip",
    payload: result,
    sync
  });

  await chrome.storage.local.set({ lastClipResult: response });
  return response;
}

async function sendNative(message) {
  try {
    return await chrome.runtime.sendNativeMessage(HOST_NAME, message);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "host_unavailable",
        message: "Host unavailable. Run the Clipplane local host setup for this browser.",
        detail: error.message
      }
    };
  }
}

function collectPagePayload(mode) {
  const selectedText = String(window.getSelection?.() || "").trim();
  const inputType = mode === "selection" && selectedText ? "selection" : "page";
  const sourceUrl = location.href;
  const sourceTitle = document.title || sourceUrl;

  if (inputType === "selection") {
    return {
      inputType,
      sourceUrl,
      sourceTitle,
      title: firstLine(selectedText, sourceTitle),
      contentMarkdown: selectedText,
      contentText: selectedText
    };
  }

  const article = pickMainElement(document);
  const markdown = elementToMarkdown(article).trim();
  const text = article.innerText.trim();

  return {
    inputType,
    sourceUrl,
    sourceTitle,
    title: sourceTitle,
    contentMarkdown: markdown || text,
    contentText: text
  };

  function pickMainElement(doc) {
    const clone = doc.body.cloneNode(true);
    for (const selector of [
      "script",
      "style",
      "noscript",
      "svg",
      "canvas",
      "iframe",
      "nav",
      "header",
      "footer",
      "aside",
      "form",
      "button",
      "[role='navigation']",
      "[aria-hidden='true']"
    ]) {
      for (const node of clone.querySelectorAll(selector)) {
        node.remove();
      }
    }

    const selectors = [
      "article",
      "main",
      "[role='main']",
      ".article",
      ".post",
      ".entry-content",
      ".content",
      "#content"
    ];

    const candidates = selectors.flatMap((selector) => [...clone.querySelectorAll(selector)]);
    candidates.push(clone);
    candidates.sort((a, b) => scoreElement(b) - scoreElement(a));
    return candidates[0] || clone;
  }

  function scoreElement(element) {
    const text = element.innerText || "";
    const paragraphs = element.querySelectorAll?.("p").length || 0;
    return text.trim().length + paragraphs * 120;
  }

  function elementToMarkdown(element) {
    const lines = [];
    walk(element, lines, { listDepth: 0 });
    return lines.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  function walk(node, lines, ctx) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue.replace(/\s+/g, " ").trim();
      if (value && !isBoilerplateText(value)) {
        appendText(lines, value);
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const tag = node.tagName.toLowerCase();
    if (tag === "br") {
      lines.push("");
      return;
    }

    if (/^h[1-6]$/.test(tag)) {
      const text = node.innerText.trim();
      if (isBoilerplateText(text)) {
        return;
      }
      blank(lines);
      lines.push(`${"#".repeat(Number(tag.slice(1)))} ${text}`);
      blank(lines);
      return;
    }

    if (tag === "p") {
      blank(lines);
      walkChildren(node, lines, ctx);
      blank(lines);
      return;
    }

    if (tag === "pre") {
      const text = node.innerText.replace(/\n+$/g, "");
      if (isBoilerplateText(text)) {
        return;
      }
      blank(lines);
      lines.push("```");
      lines.push(text);
      lines.push("```");
      blank(lines);
      return;
    }

    if (tag === "li") {
      const before = lines.length;
      walkChildren(node, lines, ctx);
      const item = lines.splice(before).join(" ").trim();
      if (item) {
        lines.push(`${"  ".repeat(ctx.listDepth)}- ${item}`);
      }
      return;
    }

    if (tag === "ul" || tag === "ol") {
      blank(lines);
      for (const child of node.children) {
        walk(child, lines, { ...ctx, listDepth: ctx.listDepth + 1 });
      }
      blank(lines);
      return;
    }

    if (tag === "a") {
      const href = node.getAttribute("href");
      const text = node.innerText.trim();
      if (isBoilerplateText(text)) {
        return;
      }
      appendText(lines, href && text ? `[${text}](${new URL(href, location.href).href})` : text);
      return;
    }

    walkChildren(node, lines, ctx);
  }

  function walkChildren(node, lines, ctx) {
    for (const child of node.childNodes) {
      walk(child, lines, ctx);
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

  function firstLine(text, fallback) {
    const line = text.split(/\r?\n/).find(Boolean) || fallback;
    return line.replace(/\s+/g, " ").slice(0, 80);
  }

  function isBoilerplateText(text) {
    const normalized = String(text).replace(/\s+/g, " ").trim();
    return /^To view keyboard shortcuts, press question mark\s*View keyboard shortcuts\.?$/i.test(normalized);
  }
}
