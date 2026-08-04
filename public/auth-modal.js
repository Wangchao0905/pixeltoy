const authDialog = document.querySelector("#authDialog");
const authForm = document.querySelector("#authModalForm");

if (authDialog && authForm) {
  const authMessage = document.querySelector("#authModalMessage");
  const authSubmit = document.querySelector("#authModalSubmit");
  const displayNameField = document.querySelector("#authModalDisplayNameField");
  const inviteCodeField = document.querySelector("#authModalInviteCodeField");
  const emailCodeField = document.querySelector("#authModalEmailCodeField");
  const sendEmailCodeButton = document.querySelector("#authModalSendEmailCode");
  const tabs = [...document.querySelectorAll("[data-auth-mode]")];
  const carousel = document.querySelector("[data-auth-carousel]");
  const carouselSlides = carousel ? [...carousel.querySelectorAll("[data-auth-slide]")] : [];
  const carouselDots = carousel ? [...carousel.querySelectorAll("[data-auth-carousel-dot]")] : [];
  const carouselPrev = carousel?.querySelector("[data-auth-carousel-prev]");
  const carouselNext = carousel?.querySelector("[data-auth-carousel-next]");
  const params = new URLSearchParams(window.location.search);
  let mode = "login";
  let pendingNext = "/";
  let authRequestInFlight = false;
  let emailCodeRequestInFlight = false;
  let emailCodeCountdown = 0;
  let emailCodeTimer = 0;
  let carouselIndex = 0;
  let carouselTimer = 0;
  const carouselReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

  function syncAuthDialogLayout() {
    if (!authDialog) return;
    const width = authDialog.getBoundingClientRect().width;
    const viewportWidth = Math.min(window.innerWidth || Infinity, window.screen?.width || Infinity);
    authDialog.classList.toggle("is-compact", (width > 0 && width < 700) || viewportWidth < 700);
  }

  function pauseCarouselMedia() {
    carouselSlides.forEach((slide) => {
      const media = slide.querySelector("video");
      if (media) media.pause();
    });
  }

  function stopCarousel() {
    window.clearTimeout(carouselTimer);
    carouselTimer = 0;
    pauseCarouselMedia();
  }

  function scheduleCarousel() {
    window.clearTimeout(carouselTimer);
    carouselTimer = 0;
    if (!carousel || carouselReducedMotion || carouselSlides.length < 2 || !authDialog.open) return;
    carouselTimer = window.setTimeout(() => {
      setCarouselSlide(carouselIndex + 1);
    }, 5200);
  }

  function setCarouselSlide(nextIndex, { restart = true } = {}) {
    if (!carouselSlides.length) return;
    carouselIndex = (Number(nextIndex) + carouselSlides.length) % carouselSlides.length;
    carouselSlides.forEach((slide, index) => {
      const active = index === carouselIndex;
      slide.classList.toggle("is-active", active);
      slide.setAttribute("aria-hidden", String(!active));
      const media = slide.querySelector("video");
      if (media) {
        if (active && authDialog.open) media.play().catch(() => {});
        else media.pause();
      }
    });
    carouselDots.forEach((dot, index) => {
      const active = index === carouselIndex;
      dot.classList.toggle("is-active", active);
      dot.setAttribute("aria-selected", String(active));
    });
    if (restart) scheduleCarousel();
  }

  function startCarousel() {
    if (!carousel) return;
    setCarouselSlide(carouselIndex, { restart: false });
    const activeVideo = carouselSlides[carouselIndex]?.querySelector("video");
    activeVideo?.play().catch(() => {});
    scheduleCarousel();
  }

  function formDataValue(name) {
    return String(new FormData(authForm).get(name) || "").trim();
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value || "").trim());
  }

  function safeNext(value) {
    const next = String(value || "").trim();
    return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/auth.html") ? next : "/";
  }

  function defaultNext() {
    const url = new URL(window.location.href);
    ["auth", "mode", "next"].forEach((key) => url.searchParams.delete(key));
    return `${url.pathname}${url.search}${url.hash}` || "/";
  }

  function setMessage(value) {
    if (authMessage) authMessage.textContent = value || "";
  }

  function stopEmailCodeCountdown() {
    window.clearTimeout(emailCodeTimer);
    emailCodeTimer = 0;
    emailCodeCountdown = 0;
    if (sendEmailCodeButton) {
      sendEmailCodeButton.disabled = false;
      sendEmailCodeButton.textContent = "发送验证码";
    }
  }

  function startEmailCodeCountdown(seconds = 60) {
    stopEmailCodeCountdown();
    emailCodeCountdown = Math.max(1, Math.min(600, Number(seconds) || 60));
    if (!sendEmailCodeButton) return;
    sendEmailCodeButton.disabled = true;
    sendEmailCodeButton.textContent = `${emailCodeCountdown}s 后重发`;
    const tick = () => {
      emailCodeCountdown -= 1;
      if (emailCodeCountdown <= 0) return stopEmailCodeCountdown();
      sendEmailCodeButton.textContent = `${emailCodeCountdown}s 后重发`;
      emailCodeTimer = window.setTimeout(tick, 1000);
    };
    emailCodeTimer = window.setTimeout(tick, 1000);
  }

  function setMode(nextMode) {
    mode = nextMode === "register" ? "register" : "login";
    tabs.forEach((tab) => {
      const active = tab.dataset.authMode === mode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    displayNameField?.classList.toggle("hidden", mode !== "register");
    inviteCodeField?.classList.toggle("hidden", mode !== "register");
    emailCodeField?.classList.toggle("hidden", mode !== "register");
    if (authForm.elements.inviteCode) authForm.elements.inviteCode.required = mode === "register";
    if (authForm.elements.emailCode) authForm.elements.emailCode.required = mode === "register";
    if (authForm.elements.password) authForm.elements.password.autocomplete = mode === "register" ? "new-password" : "current-password";
    if (authSubmit) authSubmit.textContent = mode === "register" ? "创建制作空间" : "进入制作空间";
    setMessage("");
  }

  async function authApi(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.message || result.error || `HTTP ${response.status}`);
    return result;
  }

  function openAuthDialog(nextMode = "login", nextPath = "") {
    pendingNext = safeNext(nextPath || defaultNext());
    authForm.reset();
    stopEmailCodeCountdown();
    setMode(nextMode);
    if (!authDialog.open) {
      if (typeof authDialog.showModal === "function") authDialog.showModal();
      else authDialog.setAttribute("open", "");
    }
    syncAuthDialogLayout();
    startCarousel();
    window.requestAnimationFrame(() => authForm.elements.email?.focus());
  }

  function closeAuthDialog() {
    stopEmailCodeCountdown();
    if (typeof authDialog.close === "function" && authDialog.open) authDialog.close();
    else authDialog.removeAttribute("open");
  }

  async function sendEmailCode() {
    if (emailCodeRequestInFlight || emailCodeCountdown > 0) return;
    const email = formDataValue("email");
    if (!validEmail(email)) {
      setMessage("请先输入有效的邮箱地址");
      authForm.elements.email?.focus();
      return;
    }
    emailCodeRequestInFlight = true;
    if (sendEmailCodeButton) {
      sendEmailCodeButton.disabled = true;
      sendEmailCodeButton.textContent = "发送中...";
    }
    setMessage("正在发送验证码...");
    try {
      const result = await authApi("/api/auth/email-code", { email, purpose: "register" });
      startEmailCodeCountdown(Math.max(60, Math.min(600, Number(result.expiresInSeconds) || 60)));
      setMessage("验证码已发送，请检查邮箱");
    } catch (error) {
      stopEmailCodeCountdown();
      setMessage(error.message || "验证码发送失败");
    } finally {
      emailCodeRequestInFlight = false;
    }
  }

  async function submitAuthForm(event) {
    event.preventDefault();
    if (authRequestInFlight || !authForm.reportValidity()) return;
    const email = formDataValue("email");
    if (mode === "register" && !validEmail(email)) {
      setMessage("请输入有效的邮箱地址");
      return;
    }
    authRequestInFlight = true;
    if (authSubmit) authSubmit.disabled = true;
    setMessage(mode === "register" ? "正在创建制作空间..." : "正在进入制作空间...");
    try {
      await authApi(`/api/auth/${mode}`, {
        email,
        password: formDataValue("password"),
        displayName: formDataValue("displayName"),
        inviteCode: formDataValue("inviteCode"),
        emailCode: formDataValue("emailCode"),
      });
      window.location.assign(pendingNext || "/");
    } catch (error) {
      setMessage(error.message || "操作失败，请稍后重试");
    } finally {
      authRequestInFlight = false;
      if (authSubmit) authSubmit.disabled = false;
    }
  }

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest?.("[data-auth-open]");
    if (!trigger) return;
    event.preventDefault();
    openAuthDialog(trigger.dataset.authOpen || "login", trigger.dataset.authNext || "");
  });
  tabs.forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.authMode)));
  carouselDots.forEach((dot) => dot.addEventListener("click", () => setCarouselSlide(Number(dot.dataset.authCarouselDot))));
  carouselPrev?.addEventListener("click", () => setCarouselSlide(carouselIndex - 1));
  carouselNext?.addEventListener("click", () => setCarouselSlide(carouselIndex + 1));
  document.querySelector("#closeAuthDialog")?.addEventListener("click", closeAuthDialog);
  sendEmailCodeButton?.addEventListener("click", sendEmailCode);
  authForm.addEventListener("submit", submitAuthForm);
  authDialog.addEventListener("click", (event) => {
    if (event.target === authDialog) closeAuthDialog();
  });
  authDialog.addEventListener("close", () => {
    stopEmailCodeCountdown();
    stopCarousel();
  });
  window.addEventListener("resize", syncAuthDialogLayout);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopCarousel();
    else if (authDialog.open) startCarousel();
  });
  setMode("login");
  setCarouselSlide(0, { restart: false });
  syncAuthDialogLayout();

  const initialMode = params.get("auth") || params.get("mode");
  if (initialMode === "login" || initialMode === "register") {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("auth");
    cleanUrl.searchParams.delete("mode");
    cleanUrl.searchParams.delete("next");
    window.history.replaceState(window.history.state, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    window.setTimeout(() => openAuthDialog(initialMode, params.get("next") || "/"), 0);
  }
}
