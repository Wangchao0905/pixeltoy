"""双模型 LLM 客户端（GPT 主笔 + DeepSeek 审核），标准库 urllib，零依赖。"""
import json
import os
import time
import urllib.request
import urllib.error

class LLMError(Exception):
    def __init__(self, message, category="network"):
        super().__init__(message)
        self.category = category

def load_env(path=".env"):
    env = {}
    if not os.path.exists(path):
        return env
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip()
    return env

class LLMClient:
    def __init__(self, base_url, api_key, model, timeout=120):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def chat(self, messages, temperature=0.7, max_tokens=4000):
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        url = f"{self.base_url}/chat/completions"
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url, data=data, method="POST",
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {self.api_key}"},
        )
        last_error = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    body = json.loads(resp.read().decode("utf-8"))
                    return body["choices"][0]["message"]["content"]
            except urllib.error.HTTPError as e:
                category = {401: "auth", 403: "auth", 429: "rate"}.get(e.code, "server")
                last_error = LLMError(f"HTTP {e.code}: {e.read()[:200]!r}", category)
            except (urllib.error.URLError, TimeoutError) as e:
                # 连接/发送阶段超时会被 urllib 包装成 URLError(reason=socket.timeout)，
                # 仅判断 e 自身会把最常见的连接超时误分类为 network，需同时检查 e.reason。
                # Python 3.10+ 中 socket.timeout 是 TimeoutError 的别名，isinstance 即可覆盖。
                reason = getattr(e, "reason", None)
                is_timeout = isinstance(e, TimeoutError) or isinstance(reason, TimeoutError)
                last_error = LLMError(f"network: {e}", "timeout" if is_timeout else "network")
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
        raise last_error

def make_gpt_client(env=None):
    env = env or load_env()
    return LLMClient(env.get("GPT_BASE_URL", "https://api.apikey.fun/v1"),
                     env.get("GPT_API_KEY", ""), env.get("GPT_MODEL", "gpt-5.6-terra"))

def make_deepseek_client(env=None):
    env = env or load_env()
    return LLMClient(env.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
                     env.get("DEEPSEEK_API_KEY", ""), env.get("DEEPSEEK_MODEL", "deepseek-v4-pro"))
