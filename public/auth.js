const form = document.querySelector("#authForm");
const message = document.querySelector("#authMessage");
const submit = document.querySelector("#authSubmit");
const displayNameField = document.querySelector("#displayNameField");
const inviteCodeField = document.querySelector("#inviteCodeField");
const emailCodeField = document.querySelector("#emailCodeField");
const sendEmailCodeButton = document.querySelector("#sendEmailCode");
const tabs = [...document.querySelectorAll("[data-auth-mode]")];
const params = new URLSearchParams(window.location.search);
const nextPath = params.get("next") || "/";
let mode = params.get("mode") === "register" ? "register" : "login";
let authRequestInFlight = false;
let emailCodeRequestInFlight = false;
let emailCodeCountdown = 0;

function formDataValue(name) {
  return String(new FormData(form).get(name) || "").trim();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value || "").trim());
}

function setMessage(value) {
  message.textContent = value || "";
}

function setMode(nextMode) {
  mode = nextMode === "register" ? "register" : "login";
  tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.authMode === mode));
  displayNameField.classList.toggle("hidden", mode !== "register");
  inviteCodeField.classList.toggle("hidden", mode !== "register");
  emailCodeField.classList.toggle("hidden", mode !== "register");
  form.elements.inviteCode.required = mode === "register";
  form.elements.emailCode.required = mode === "register";
  const identityField = form.elements.email;
  if (identityField) {
    identityField.type = mode === "register" ? "email" : "text";
    identityField.inputMode = mode === "register" ? "email" : "text";
    identityField.placeholder = mode === "register" ? "name@example.com" : "Email or username";
  }
  submit.textContent = mode === "register" ? "Create studio access" : "Enter studio";
  form.elements.password.autocomplete = mode === "register" ? "new-password" : "current-password";
  setMessage("");
}

async function api(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.message || `HTTP ${response.status}`);
  return result;
}

function safeNext(value) {
  return !value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/auth.html") ? "/" : value;
}

function stopEmailCodeCountdown() {
  emailCodeCountdown = 0;
  sendEmailCodeButton.disabled = false;
  sendEmailCodeButton.textContent = "Send code";
}

function startEmailCodeCountdown(seconds = 60) {
  emailCodeCountdown = Math.max(1, Math.min(600, Number(seconds) || 60));
  sendEmailCodeButton.disabled = true;
  sendEmailCodeButton.textContent = `Resend in ${emailCodeCountdown}s`;
  const tick = () => {
    emailCodeCountdown -= 1;
    if (emailCodeCountdown <= 0) return stopEmailCodeCountdown();
    sendEmailCodeButton.textContent = `Resend in ${emailCodeCountdown}s`;
    window.setTimeout(tick, 1000);
  };
  window.setTimeout(tick, 1000);
}

async function sendEmailCode() {
  if (emailCodeRequestInFlight || emailCodeCountdown > 0) return;
  const email = formDataValue("email");
  if (!validEmail(email)) {
    setMessage("Please enter a valid email address first.");
    form.elements.email.focus();
    return;
  }
  emailCodeRequestInFlight = true;
  sendEmailCodeButton.disabled = true;
  sendEmailCodeButton.textContent = "Sending...";
  setMessage("Sending verification code...");
  try {
    const result = await api("/api/auth/email-code", { email, purpose: "register" });
    startEmailCodeCountdown(Math.max(60, Math.min(600, Number(result.expiresInSeconds) || 60)));
    setMessage("Verification code sent.");
  } catch (error) {
    stopEmailCodeCountdown();
    setMessage(error.message || "Unable to send verification code.");
  } finally {
    emailCodeRequestInFlight = false;
  }
}

async function submitAuthForm(event) {
  event.preventDefault();
  if (authRequestInFlight || !form.reportValidity()) return;
  const email = formDataValue("email");
  if (mode === "register" && !validEmail(email)) {
    setMessage("Please enter a valid email address.");
    return;
  }
  authRequestInFlight = true;
  submit.disabled = true;
  setMessage(mode === "register" ? "Creating your production workspace..." : "Opening your film workspace...");
  try {
    const payload = {
      email,
      password: formDataValue("password"),
      displayName: formDataValue("displayName"),
      inviteCode: formDataValue("inviteCode"),
      emailCode: formDataValue("emailCode"),
    };
    await api(`/api/auth/${mode}`, payload);
    window.location.href = safeNext(nextPath);
  } catch (error) {
    setMessage(error.message || "Request failed");
  } finally {
    submit.disabled = false;
    authRequestInFlight = false;
  }
}

tabs.forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.authMode)));
sendEmailCodeButton.addEventListener("click", sendEmailCode);
form.addEventListener("submit", submitAuthForm);
setMode(mode);

fetch("/api/auth/me")
  .then((response) => response.json())
  .then((result) => {
    if (result.user) window.location.href = safeNext(nextPath);
  })
  .catch(() => {});
