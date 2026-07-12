(() => {
  const PICKER_ATTRIBUTE = "data-clipplane-picker-target";
  const PICKER_ACTIVE_ATTRIBUTE = "data-clipplane-picker-active";
  const PICKER_TIMEOUT_MS = 60_000;
  const MIN_READABILITY_TEXT_LENGTH = 160;
  const DEFAULT_CAPTURE_PROCESSING_BUDGET_MS = 1_500;
  const DEFAULT_CAPTURE_PAYLOAD_BYTES = 4 * 1024 * 1024;
  const captureLimits = {
    processingBudgetMs: positiveLimit(globalThis.__clipplaneCaptureConfig?.processingBudgetMs, DEFAULT_CAPTURE_PROCESSING_BUDGET_MS),
    payloadBytes: positiveLimit(globalThis.__clipplaneCaptureConfig?.payloadBytes, DEFAULT_CAPTURE_PAYLOAD_BYTES)
  };
  let activePicker = null;

  globalThis.__clipplaneCapture?.cancelElementPicker?.("superseded");
  globalThis.__clipplaneCapture = {
    capture,
    captureElement,
    startElementPicker,
    cancelElementPicker
  };

  function capture(mode) {
    const startedAt = performance.now();
    const selectedText = String(window.getSelection?.() || "").trim();
    const sourceUrl = location.href;
    const sourceTitle = document.title || sourceUrl;

    if (mode === "selection" && selectedText) {
      return finalizeCapture({
        inputType: "selection",
        extractionMethod: "selection",
        sourceUrl,
        sourceTitle,
        title: firstLine(selectedText, sourceTitle),
        contentMarkdown: selectedText,
        contentText: selectedText
      }, startedAt);
    }

    return finalizeCapture(capturePage(sourceUrl, sourceTitle), startedAt);
  }

  function capturePage(sourceUrl, sourceTitle) {
    const readable = captureWithReadability(sourceUrl, sourceTitle);
    if (readable) {
      return readable;
    }

    const content = domNormalizer().captureFallback(document, sourceUrl);
    return {
      inputType: "page",
      extractionMethod: "fallback",
      sourceUrl,
      sourceTitle,
      title: sourceTitle,
      contentMarkdown: content.markdown || content.text,
      contentText: content.text
    };
  }

  function captureWithReadability(sourceUrl, sourceTitle) {
    if (typeof globalThis.Readability !== "function") {
      return null;
    }

    try {
      const readableDocument = document.cloneNode(true);
      for (const hidden of readableDocument.querySelectorAll('[hidden], [aria-hidden="true"], [style*="display:none" i], [style*="display: none" i], [style*="visibility:hidden" i], [style*="visibility: hidden" i]')) {
        hidden.remove();
      }
      const article = new globalThis.Readability(readableDocument, {
        charThreshold: MIN_READABILITY_TEXT_LENGTH
      }).parse();
      if (!article || cleanText(article.textContent).length < MIN_READABILITY_TEXT_LENGTH) {
        return null;
      }

      const container = document.createElement("div");
      container.innerHTML = article.content || "";
      const content = domNormalizer().normalizeElement(container, { profile: "article", sourceUrl });
      if (!(content.markdown || content.text)) {
        return null;
      }

      return {
        inputType: "page",
        extractionMethod: "readability",
        sourceUrl,
        sourceTitle,
        title: firstLine(article.title, sourceTitle),
        contentMarkdown: content.markdown || content.text,
        contentText: content.text
      };
    } catch {
      return null;
    }
  }

  function startElementPicker(requestId) {
    if (!requestId || typeof requestId !== "string") {
      throw new Error("Missing element capture request.");
    }

    activePicker?.finish({ cancelled: true, reason: "superseded" });

    const style = ensurePickerStyle();
    document.documentElement.setAttribute(PICKER_ACTIVE_ATTRIBUTE, "true");
    let highlighted = null;
    let originalHighlight = null;
    let finished = false;
    let timeoutId;

    const clearHighlight = () => {
      if (!highlighted) {
        return;
      }
      if (originalHighlight === null) {
        highlighted.removeAttribute(PICKER_ATTRIBUTE);
      } else {
        highlighted.setAttribute(PICKER_ATTRIBUTE, originalHighlight);
      }
      highlighted = null;
      originalHighlight = null;
    };

    const updateHighlight = (event) => {
      const candidate = findCaptureTarget(eventTarget(event));
      if (candidate === highlighted) {
        return;
      }
      clearHighlight();
      if (candidate) {
        highlighted = candidate;
        originalHighlight = candidate.getAttribute(PICKER_ATTRIBUTE);
        candidate.setAttribute(PICKER_ATTRIBUTE, "true");
      }
    };

    const finish = (result) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutId);
      document.removeEventListener("pointermove", updateHighlight, true);
      document.removeEventListener("pointerdown", preventPageAction, true);
      document.removeEventListener("click", confirmSelection, true);
      document.removeEventListener("keydown", cancelOnEscape, true);
      clearHighlight();
      style.remove();
      document.documentElement.removeAttribute(PICKER_ACTIVE_ATTRIBUTE);
      if (activePicker?.requestId === requestId) {
        activePicker = null;
      }
      sendPickerResult({ type: "element_capture_result", requestId, ...result });
    };

    const preventPageAction = (event) => {
      if (!findCaptureTarget(eventTarget(event))) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const confirmSelection = (event) => {
      const target = findCaptureTarget(eventTarget(event)) || highlighted;
      if (!target) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();

      const payload = captureElement(target);
      if (payload.__clipplaneError) {
        finish({ error: payload.__clipplaneError });
        return;
      }
      if (!payload.contentMarkdown) {
        finish({ error: { code: "empty_element", message: "That area has no capturable text." } });
        return;
      }
      finish({ payload });
    };

    const cancelOnEscape = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish({ cancelled: true, reason: "cancelled" });
      }
    };

    document.addEventListener("pointermove", updateHighlight, true);
    document.addEventListener("pointerdown", preventPageAction, true);
    document.addEventListener("click", confirmSelection, true);
    document.addEventListener("keydown", cancelOnEscape, true);
    timeoutId = window.setTimeout(() => finish({ cancelled: true, reason: "timeout" }), PICKER_TIMEOUT_MS);
    activePicker = { requestId, finish };
  }

  function cancelElementPicker(reason = "cancelled") {
    activePicker?.finish({ cancelled: true, reason });
  }

  function captureElement(element) {
    const startedAt = performance.now();
    const sourceUrl = location.href;
    const sourceTitle = document.title || sourceUrl;
    const content = domNormalizer().normalizeElement(element, { profile: "element", sourceUrl });

    return finalizeCapture({
      inputType: "element",
      extractionMethod: "element",
      sourceUrl,
      sourceTitle,
      title: firstLine(content.text, sourceTitle),
      contentMarkdown: content.markdown || content.text,
      contentText: content.text
    }, startedAt);
  }

  function findCaptureTarget(start) {
    return domNormalizer().findElementTarget(start);
  }

  function domNormalizer() {
    if (!globalThis.__clipplaneDom) {
      throw new Error("Clipplane DOM normalizer is unavailable.");
    }
    return globalThis.__clipplaneDom;
  }

  function eventTarget(event) {
    return event.composedPath?.().find((node) => node instanceof Element) || event.target;
  }

  function ensurePickerStyle() {
    const style = document.createElement("style");
    style.textContent = `
      [${PICKER_ATTRIBUTE}] { outline: 3px solid oklch(68% .14 50) !important; outline-offset: 3px !important; cursor: crosshair !important; }
      html[${PICKER_ACTIVE_ATTRIBUTE}]::before { content: "Clipplane · Click an area to save · Esc to cancel"; position: fixed; z-index: 2147483647; top: 14px; left: 50%; max-width: calc(100vw - 28px); padding: 9px 12px; border: 1px solid oklch(68% .14 50); border-radius: 8px; background: oklch(21% .04 163); color: oklch(98% .006 165); box-shadow: 0 8px 24px rgba(0, 0, 0, .18); font: 700 12px/1.3 ui-sans-serif, system-ui, sans-serif; text-align: center; transform: translateX(-50%); pointer-events: none; }
    `;
    (document.head || document.documentElement).append(style);
    return style;
  }

  function sendPickerResult(message) {
    try {
      const sent = globalThis.chrome?.runtime?.sendMessage(message);
      if (sent?.catch) {
        sent.catch(() => {});
      }
    } catch {
      // The picker is best-effort when its extension context is no longer available.
    }
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function firstLine(text, fallback) {
    const line = String(text || "").split(/\r?\n/).find(Boolean) || fallback;
    return cleanText(line).slice(0, 80) || fallback;
  }

  function finalizeCapture(payload, startedAt) {
    const elapsed = performance.now() - startedAt;
    if (elapsed > captureLimits.processingBudgetMs) {
      return captureError(
        "capture_timed_out",
        "This page took too long to process. Try Selection or Element instead."
      );
    }
    if (new Blob([JSON.stringify(payload)]).size > captureLimits.payloadBytes) {
      return captureError(
        "capture_too_large",
        "This page is too large to save as one clip. Try Selection or Element instead."
      );
    }
    return payload;
  }

  function captureError(code, message) {
    return { __clipplaneError: { code, message } };
  }

  function positiveLimit(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }
})();
