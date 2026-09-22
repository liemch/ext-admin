(() => {
  "use strict";

  const MAX_AMOUNT = 10_000_000;
  const MIN_AMOUNT = 1_000;
  const viCurrency = new Intl.NumberFormat("vi-VN");

  const form = document.getElementById("transferForm");
  const recipientInput = document.getElementById("recipient");
  const amountInput = document.getElementById("amount");
  const clearRecipient = document.getElementById("clearRecipient");
  const quickAmountButtons = [...document.querySelectorAll("[data-amount]")];
  const summaryAmount = document.getElementById("summaryAmount");
  const summaryRecipient = document.getElementById("summaryRecipient");
  const recipientError = document.getElementById("recipientError");
  const amountError = document.getElementById("amountError");
  const sendButton = document.getElementById("sendButton");
  const modalBackdrop = document.getElementById("modalBackdrop");
  const successModal = document.getElementById("successModal");
  const successAmount = document.getElementById("successAmount");
  const successRecipient = document.getElementById("successRecipient");
  const transactionId = document.getElementById("transactionId");
  const transactionTime = document.getElementById("transactionTime");
  const doneButton = document.getElementById("doneButton");
  const againButton = document.getElementById("againButton");

  let lastFocusedElement = null;

  function digitsOnly(value) {
    return value.replace(/\D/g, "");
  }

  function getAmount() {
    const digits = digitsOnly(amountInput.value);
    return digits ? Number(digits) : 0;
  }

  function formatMoney(amount) {
    return `${viCurrency.format(amount)} ₫`;
  }

  function formatAmountInput() {
    const digits = digitsOnly(amountInput.value);
    amountInput.value = digits ? viCurrency.format(Number(digits)) : "";
  }

  function setError(input, errorElement, message) {
    const group = input.closest(".field-group");
    group.classList.toggle("has-error", Boolean(message));
    errorElement.textContent = message;
    input.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function validateRecipient(showError = true) {
    const value = recipientInput.value.trim();
    let message = "";

    if (!value) {
      message = "Vui lòng nhập tên người nhận.";
    } else if (value.length < 2) {
      message = "Tên người nhận cần có ít nhất 2 ký tự.";
    }

    if (showError) {
      setError(recipientInput, recipientError, message);
    }
    return !message;
  }

  function validateAmount(showError = true) {
    const amount = getAmount();
    let message = "";

    if (!amount) {
      message = "Vui lòng nhập số tiền muốn chuyển.";
    } else if (amount < MIN_AMOUNT) {
      message = `Số tiền tối thiểu là ${formatMoney(MIN_AMOUNT)}.`;
    } else if (amount > MAX_AMOUNT) {
      message = `Hạn mức mỗi giao dịch là ${formatMoney(MAX_AMOUNT)}.`;
    }

    if (showError) {
      setError(amountInput, amountError, message);
    }
    return !message;
  }

  function updateQuickAmounts(amount) {
    quickAmountButtons.forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.amount) === amount);
    });
  }

  function updateSummary() {
    const recipient = recipientInput.value.trim();
    const amount = getAmount();

    summaryRecipient.textContent = recipient || "Chưa chọn người nhận";
    summaryAmount.textContent = amount ? formatMoney(amount) : "0 ₫";
    updateQuickAmounts(amount);
  }

  function resetForm({ focusRecipient = false } = {}) {
    form.reset();
    setError(recipientInput, recipientError, "");
    setError(amountInput, amountError, "");
    updateSummary();
    clearRecipient.hidden = true;

    if (focusRecipient) {
      recipientInput.focus();
    }
  }

  function createTransactionId() {
    const random = Math.floor(100000 + Math.random() * 900000);
    return `LM${new Date().getFullYear()}-${random}`;
  }

  function currentDateTime() {
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
  }

  function showSuccess() {
    const amount = getAmount();
    const recipient = recipientInput.value.trim();

    successAmount.textContent = formatMoney(amount);
    successRecipient.textContent = recipient;
    transactionId.textContent = createTransactionId();
    transactionTime.textContent = currentDateTime();

    lastFocusedElement = document.activeElement;
    modalBackdrop.hidden = false;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => successModal.focus(), 0);
  }

  function closeSuccess({ reset = false } = {}) {
    modalBackdrop.hidden = true;
    document.body.style.overflow = "";

    if (reset) {
      resetForm({ focusRecipient: true });
      return;
    }

    if (lastFocusedElement instanceof HTMLElement) {
      lastFocusedElement.focus();
    }
  }

  recipientInput.addEventListener("input", () => {
    clearRecipient.hidden = !recipientInput.value;
    if (recipientError.textContent) validateRecipient();
    updateSummary();
  });

  recipientInput.addEventListener("blur", () => validateRecipient());

  clearRecipient.addEventListener("click", () => {
    recipientInput.value = "";
    clearRecipient.hidden = true;
    setError(recipientInput, recipientError, "");
    updateSummary();
    recipientInput.focus();
  });

  amountInput.addEventListener("input", () => {
    formatAmountInput();
    if (amountError.textContent) validateAmount();
    updateSummary();
  });

  amountInput.addEventListener("blur", () => validateAmount());

  quickAmountButtons.forEach((button) => {
    button.addEventListener("click", () => {
      amountInput.value = viCurrency.format(Number(button.dataset.amount));
      validateAmount();
      updateSummary();
      amountInput.focus();
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const recipientIsValid = validateRecipient();
    const amountIsValid = validateAmount();

    if (!recipientIsValid || !amountIsValid) {
      const firstInvalidInput = !recipientIsValid ? recipientInput : amountInput;
      firstInvalidInput.focus();
      return;
    }

    sendButton.disabled = true;
    sendButton.querySelector("span").textContent = "Đang chuyển tiền...";

    window.setTimeout(() => {
      sendButton.disabled = false;
      sendButton.querySelector("span").textContent = "Chuyển tiền";
      showSuccess();
    }, 550);
  });

  doneButton.addEventListener("click", () => closeSuccess());
  againButton.addEventListener("click", () => closeSuccess({ reset: true }));

  modalBackdrop.addEventListener("click", (event) => {
    if (event.target === modalBackdrop) closeSuccess();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modalBackdrop.hidden) {
      closeSuccess();
    }
  });

  updateSummary();
})();
