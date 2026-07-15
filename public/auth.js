const form = document.querySelector("#authForm");
const message = document.querySelector("#authMessage");
const submit = document.querySelector("#authSubmit");
const displayNameField = document.querySelector("#displayNameField");
const inviteCodeField = document.querySelector("#inviteCodeField");
const tabs = [...document.querySelectorAll("[data-auth-mode]")];
const params = new URLSearchParams(window.location.search);
const nextPath = params.get("next") || "/";
let mode = params.get("mode") === "register" ? "register" : "login";
let authRequestInFlight = false;

function formDataValue(name) {
  return String(new FormData(form).get(name) || "").trim();
}

function setMode(nextMode) {
  mode = nextMode === "register" ? "register" : "login";
  tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.authMode === mode));
  displayNameField.classList.toggle("hidden", mode !== "register");
  inviteCodeField.classList.toggle("hidden", mode !== "register");
  form.elements.inviteCode.required = mode === "register";
  submit.textContent = mode === "register" ? "Create studio access" : "Enter studio";
  form.elements.password.autocomplete = mode === "register" ? "new-password" : "current-password";
  message.textContent = "";
}

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

function safeNext(path) {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/";
  if (path.startsWith("/auth.html")) return "/";
  return path;
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.authMode));
});

async function submitAuthForm(event) {
  event.preventDefault();
  event.stopPropagation();
  if (authRequestInFlight || !form.reportValidity()) return false;
  authRequestInFlight = true;
  submit.disabled = true;
  message.textContent = mode === "register" ? "Creating your production workspace..." : "Opening your film workspace...";
  try {
    const body = {
      username: formDataValue("username"),
      password: formDataValue("password"),
      displayName: formDataValue("displayName"),
      inviteCode: formDataValue("inviteCode"),
    };
    await api(`/api/auth/${mode}`, body);
    window.location.href = safeNext(nextPath);
  } catch (error) {
    message.textContent = error.message || "Request failed";
  } finally {
    submit.disabled = false;
    authRequestInFlight = false;
  }
  return false;
}

window.pixelToysAuthSubmit = (event) => {
  submitAuthForm(event);
  return false;
};

document.addEventListener(
  "submit",
  (event) => {
    if (event.target === form) submitAuthForm(event);
  },
  true,
);

submit.addEventListener("click", (event) => {
  submitAuthForm(event);
});

fetch("/api/auth/me")
  .then((res) => res.json())
  .then((data) => {
    if (data.user) window.location.href = safeNext(nextPath);
  })
  .catch(() => {});

setMode(mode);
