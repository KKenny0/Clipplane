const stateEl = document.querySelector("#state");
const resultEl = document.querySelector("#result");
const buttons = [...document.querySelectorAll("button")];

document.querySelector("#clip-selection").addEventListener("click", () => clip("selection"));
document.querySelector("#clip-page").addEventListener("click", () => clip("page"));

chrome.storage.local.get("lastClipResult").then(({ lastClipResult }) => {
  if (lastClipResult) {
    renderResult(lastClipResult);
  }
});

async function clip(mode) {
  setBusy(true);
  try {
    const response = await chrome.runtime.sendMessage({ type: "clip", mode });
    renderResult(response);
  } catch (error) {
    renderResult({ ok: false, error: { message: error.message } });
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  stateEl.textContent = isBusy ? "Clipping" : "Ready";
  for (const button of buttons) {
    button.disabled = isBusy;
  }
}

function renderResult(response) {
  if (!response?.ok) {
    resultEl.className = "result error";
    resultEl.textContent = response?.error?.message || "Clip failed.";
    return;
  }

  resultEl.className = "result";
  const capture = response.capture;
  const duplicate = response.duplicate ? "Duplicate skipped" : "Saved";
  resultEl.textContent = `${duplicate}\n${capture.title}\n${capture.local_path}`;
}
