document.getElementById("optionsLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

async function render() {
  const { notes } = await chrome.storage.local.get(["notes"]);
  const list = document.getElementById("list");
  const entries = Object.values(notes || {}).sort((a, b) => b.updatedAt - a.updatedAt);

  if (!entries.length) {
    list.innerHTML = '<div class="empty">Inga sparade bostäder än. Öppna en annons på Hemnet eller Booli för att börja.</div>';
    return;
  }

  list.innerHTML = entries
    .map(
      (e) => `
      <div class="home">
        <div class="addr"><a class="gohome" href="${e.url}" target="_blank">${e.address}</a></div>
        <div class="stars">${"★".repeat(e.stars)}${"☆".repeat(5 - e.stars)}</div>
        ${e.text ? `<div class="note">${e.text}</div>` : ""}
      </div>`
    )
    .join("");
}

render();
