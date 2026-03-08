import subprocess, json, time, base64, os, signal, asyncio
import requests, websockets

GAME_URL   = "https://68gbvn88.bar/"
BOT_SERVER = os.environ.get("BOT_SERVER", "http://localhost:8080/")

async def fetch_token() -> bool:
    print("🚀 [FETCH] Khởi động Chrome headless...")

    # Kill chrome cũ (nếu còn)
    subprocess.run(["pkill", "-9", "-f", "google-chrome"], stderr=subprocess.DEVNULL)

    proc = subprocess.Popen([
        "google-chrome",
        "--headless=new",
        "--remote-debugging-port=9222",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "--user-data-dir=/tmp/bot_chrome_profile",
        GAME_URL
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # Đợi Chrome mở cổng debug (tối đa 15s)
    ws_url = None
    for i in range(15):
        await asyncio.sleep(1)
        try:
            pages = requests.get("http://localhost:9222/json", timeout=2).json()
            ws_url = next((p["webSocketDebuggerUrl"] for p in pages if p["type"] == "page"), None)
            if ws_url:
                break
        except Exception:
            if i % 3 == 0:
                print(f"⏳ [FETCH] Đợi Chrome... ({i}s)")

    if not ws_url:
        print("❌ [FETCH] Chrome không phản hồi sau 15s.")
        _kill(proc)
        return False

    try:
        async with websockets.connect(ws_url) as ws:
            for cmd_id, method in [(1, "Network.enable"), (2, "Page.enable"), (3, "Runtime.enable")]:
                await ws.send(json.dumps({"id": cmd_id, "method": method}))

            print("📡 [FETCH] Đang đợi game tải và bắt token...")
            start = time.time()

            while time.time() - start < 180:
                try:
                    data = json.loads(await asyncio.wait_for(ws.recv(), timeout=2.0))
                except asyncio.TimeoutError:
                    # Thử click để phá popup
                    elapsed = int(time.time() - start)
                    if 15 < elapsed < 60 and elapsed % 10 == 0:
                        for x, y in [(600, 500), (400, 700), (800, 700)]:
                            for ev in ("mousePressed", "mouseReleased"):
                                await ws.send(json.dumps({
                                    "id": 9000 + x,
                                    "method": "Input.dispatchMouseEvent",
                                    "params": {"type": ev, "x": x, "y": y, "button": "left", "clickCount": 1}
                                }))
                        print(f"🖱️ [FETCH] Click phá popup ({elapsed}s)...")
                    continue

                # Bắt WebSocket frame gửi đi từ trang
                if data.get("method") == "Network.webSocketFrameSent":
                    payload = data["params"]["response"]["payloadData"]
                    try:
                        raw = base64.b64decode(payload)
                        if len(raw) > 50 and raw[0] == 0x04:
                            hex_str = "b'" + "".join(f"\\x{b:02x}" for b in raw) + "'"
                            requests.post(BOT_SERVER, json={"token": hex_str}, timeout=5)
                            print("✅ [FETCH] Token đã bắt và gửi về Bot!")
                            return True
                    except Exception:
                        pass

    except Exception as e:
        print(f"❌ [FETCH] Lỗi CDP: {e}")
    finally:
        _kill(proc)

    return False

def _kill(proc):
    try:
        os.kill(proc.pid, signal.SIGTERM)
        time.sleep(1)
    except Exception:
        pass
    subprocess.run(["pkill", "-9", "-f", "google-chrome"], stderr=subprocess.DEVNULL)

if __name__ == "__main__":
    asyncio.run(fetch_token())
