const DEFAULTS = { interestPct: 4.0, amortizationPct: 2.0, downPaymentPct: 15 };

const els = {
  interestPct: document.getElementById("interestPct"),
  amortizationPct: document.getElementById("amortizationPct"),
  downPaymentPct: document.getElementById("downPaymentPct")
};
const saveBtn = document.getElementById("saveBtn");
const savedEl = document.getElementById("saved");

async function load() {
  const { assumptions } = await chrome.storage.local.get(["assumptions"]);
  const values = assumptions || DEFAULTS;
  els.interestPct.value = values.interestPct;
  els.amortizationPct.value = values.amortizationPct;
  els.downPaymentPct.value = values.downPaymentPct;
}

saveBtn.addEventListener("click", async () => {
  const assumptions = {
    interestPct: parseFloat(els.interestPct.value) || DEFAULTS.interestPct,
    amortizationPct: parseFloat(els.amortizationPct.value) || DEFAULTS.amortizationPct,
    downPaymentPct: parseFloat(els.downPaymentPct.value) || DEFAULTS.downPaymentPct
  };
  await chrome.storage.local.set({ assumptions });
  savedEl.textContent = "Sparat.";
  setTimeout(() => (savedEl.textContent = ""), 2000);
});

load();
