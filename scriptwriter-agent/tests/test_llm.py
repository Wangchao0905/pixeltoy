"""Task 2: llm.py 双模型客户端测试。

覆盖：
- load_env 对 .env 文件的真实解析（KEY=VALUE、忽略 # 注释与空行、文件缺失）
- LLMError 错误分类（auth/rate/server/network/timeout）
- LLMClient.chat 对 HTTP 错误码与网络错误的分类
- LLMClient.chat 成功返回内容
- make_gpt_client / make_deepseek_client 从 env 装配
"""
import io
import json
import os
import tempfile
import unittest
from unittest import mock

import urllib.error

from llm import load_env, LLMClient, LLMError, make_gpt_client, make_deepseek_client


class TestLoadEnv(unittest.TestCase):
    """load_env 真实解析行为：KEY=VALUE、忽略 # 注释与空行。"""

    def _write_env(self, content):
        """写入临时 .env 文件并返回路径。"""
        fd, path = tempfile.mkstemp(suffix=".env")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        return path

    def test_parse_key_value(self):
        path = self._write_env(
            "GPT_BASE_URL=https://api.example.com/v1\n"
            "GPT_API_KEY=sk-123\n")
        try:
            env = load_env(path)
            self.assertEqual(env["GPT_BASE_URL"], "https://api.example.com/v1")
            self.assertEqual(env["GPT_API_KEY"], "sk-123")
        finally:
            os.unlink(path)

    def test_ignore_comments_and_blank_lines(self):
        path = self._write_env(
            "# 这是注释行\n"
            "\n"
            "GPT_MODEL=gpt-5.6-terra\n"
            "   # 带缩进的注释\n"
            "DEEPSEEK_MODEL=deepseek-v4-pro\n")
        try:
            env = load_env(path)
            self.assertEqual(env, {
                "GPT_MODEL": "gpt-5.6-terra",
                "DEEPSEEK_MODEL": "deepseek-v4-pro",
            })
        finally:
            os.unlink(path)

    def test_missing_file_returns_empty(self):
        self.assertEqual(load_env("/nonexistent/dir/.env"), {})


class TestLLMClient(unittest.TestCase):
    """LLMClient 错误分类与 chat 行为。"""

    def test_error_category_classification(self):
        # LLMError 自身携带分类；401 → auth，429 → rate，500 → server
        self.assertEqual(LLMError("x", "auth").category, "auth")
        self.assertEqual(LLMError("x", "rate").category, "rate")
        self.assertEqual(LLMError("x", "server").category, "server")

    def test_http_error_categories(self):
        # 模拟 urlopen 抛 HTTPError，验证 401/403 → auth、429 → rate、其他 5xx → server
        client = LLMClient("http://localhost:9", "k", "m")
        for code, expected in [(401, "auth"), (403, "auth"), (429, "rate"), (500, "server")]:
            http_err = urllib.error.HTTPError(
                "http://localhost:9/chat/completions", code, "boom", {},
                io.BytesIO(b"error body"))
            with mock.patch("urllib.request.urlopen", side_effect=http_err), \
                 mock.patch("llm.time.sleep"):
                with self.assertRaises(LLMError) as cm:
                    client.chat([{"role": "user", "content": "hi"}])
            self.assertEqual(cm.exception.category, expected,
                             f"HTTP {code} 应归类为 {expected}")

    def test_network_and_timeout_categories(self):
        # 连接失败 → network；超时 → timeout
        client = LLMClient("http://localhost:9", "k", "m")
        with mock.patch("urllib.request.urlopen",
                        side_effect=urllib.error.URLError("connection refused")), \
             mock.patch("llm.time.sleep"):
            with self.assertRaises(LLMError) as cm:
                client.chat([{"role": "user", "content": "hi"}])
        self.assertEqual(cm.exception.category, "network")

        with mock.patch("urllib.request.urlopen", side_effect=TimeoutError("timed out")), \
             mock.patch("llm.time.sleep"):
            with self.assertRaises(LLMError) as cm:
                client.chat([{"role": "user", "content": "hi"}])
        self.assertEqual(cm.exception.category, "timeout")

    def test_urlerror_wrapped_timeout(self):
        # 真实 urllib 下连接/发送阶段超时抛 URLError(reason=TimeoutError)，
        # 必须识别 reason 并将其归类为 timeout 而非 network
        client = LLMClient("http://localhost:9", "k", "m")
        with mock.patch("urllib.request.urlopen",
                        side_effect=urllib.error.URLError(TimeoutError("timed out"))), \
             mock.patch("llm.time.sleep"):
            with self.assertRaises(LLMError) as cm:
                client.chat([{"role": "user", "content": "hi"}])
        self.assertEqual(cm.exception.category, "timeout")

    def test_chat_returns_content(self):
        client = LLMClient("http://localhost:9", "k", "m")
        fake_resp = mock.MagicMock()
        fake_resp.read.return_value = json.dumps({
            "choices": [{"message": {"content": "你好，编剧"}}],
        }).encode("utf-8")
        # 让 with 语句的 __enter__ 返回自身，保证 read() 返回上面配置的 bytes
        fake_resp.__enter__.return_value = fake_resp
        with mock.patch("urllib.request.urlopen", return_value=fake_resp):
            content = client.chat([{"role": "user", "content": "写一个开场"}])
        self.assertEqual(content, "你好，编剧")


class TestMakeClients(unittest.TestCase):
    """从 env 装配 GPT / DeepSeek 客户端。"""

    def test_make_clients_from_env(self):
        env = {
            "GPT_BASE_URL": "https://g.example/v1",
            "GPT_API_KEY": "gk",
            "GPT_MODEL": "gm",
            "DEEPSEEK_BASE_URL": "https://d.example/v1",
            "DEEPSEEK_API_KEY": "dk",
            "DEEPSEEK_MODEL": "dm",
        }
        gpt = make_gpt_client(env)
        self.assertIsInstance(gpt, LLMClient)
        self.assertEqual((gpt.base_url, gpt.model), ("https://g.example/v1", "gm"))
        deepseek = make_deepseek_client(env)
        self.assertIsInstance(deepseek, LLMClient)
        self.assertEqual((deepseek.base_url, deepseek.model),
                         ("https://d.example/v1", "dm"))


if __name__ == "__main__":
    unittest.main()
