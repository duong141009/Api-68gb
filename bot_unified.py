import websocket, struct, time, threading, sys, random, json, os, subprocess, re
import http.server
from datetime import datetime

# ─── CẤU HÌNH ────────────────────────────────────────────────────────────────
WS_URL      = "wss://mpaebq07x.cq.qnwxdhwica.com/"
TOKEN_FILE  = "token_shared.bin"
PORT        = int(os.environ.get("PORT", 8080))
DEBUG_HEX   = False

PKT_HANDSHAKE = b'\x01\x00\x00\x72{"sys":{"platform":"js-websocket","clientBuildNumber":"0.0.1","clientVersion":"0a21481d746f92f8428e1b6deeb76fea"}}'
PKT_HANDSHAKE_ACK = b'\x02\x00\x00\x00'
PKT_HEARTBEAT     = b'\x03\x00\x00\x00'

# Shared Auth Token
PKT_AUTH = b'\x04\x00\x00\x4d\x01\x01\x00\x01\x08\x02\x10\xca\x01\x1a\x40' \
           b'\x64\x36\x37\x37\x38\x66\x32\x30\x34\x38\x62\x33\x34\x34\x34' \
           b'\x66\x62\x33\x36\x61\x33\x35\x35\x39\x38\x37\x36\x31\x62\x62' \
           b'\x40\x36\x33\x36\x34\x65\x35\x30\x34\x64\x31\x34\x32\x34\x62' \
           b'\x61\x63\x39\x37\x38\x66\x63\x63\x61\x64\x64\x38\x38\x39\x62' \
           b'\x34\x66\x65\x42\x00'

env_token = os.environ.get("AUTH_TOKEN_HEX")
if env_token:
    try:
        PKT_AUTH = bytes.fromhex(env_token.replace("0x", "").strip())
    except: pass

if os.path.exists(TOKEN_FILE):
    try: PKT_AUTH = open(TOKEN_FILE, "rb").read()
    except: pass

# Global instances for API
bot_txhu = None
bot_txmd5 = None
last_fetch_time = 0
fetch_lock = threading.Lock()

def trigger_auto_fetch():
    global last_fetch_time
    with fetch_lock:
        if time.time() - last_fetch_time < 60: # Không fetch quá 1 lần/phút
            return
        last_fetch_time = time.time()
        print("🔄 [SYSTEM] Triggering auto_fetcher.py...")
        try:
            # Chạy subprocess để gọi script fetch token
            subprocess.Popen([sys.executable, "auto_fetcher.py"], 
                             env={**os.environ, "BOT_SERVER": f"http://localhost:{PORT}/"},
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            print(f"❌ [SYSTEM] Failed to trigger auto_fetch: {e}")

# ─── API HANDLER ─────────────────────────────────────────────────────────────
class UnifiedHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self): self._cors(200)

    def do_POST(self):
        if self.path in ['/api/token', '/']:
            try:
                body = self.rfile.read(int(self.headers["Content-Length"]))
                hex_token = json.loads(body).get("token", "")
                token_bytes = bytes.fromhex(hex_token.replace("b'", "").replace("'", "").replace("\\x", "").replace(" ", ""))
                global PKT_AUTH
                PKT_AUTH = token_bytes
                try: open(TOKEN_FILE, "wb").write(token_bytes)
                except: pass
                print("🔥 [TOKEN] Shared Token Updated! Reconnecting bots...")
                self._cors(200, {"status": "ok"})
                # Restart bots
                for b in [bot_txhu, bot_txmd5]:
                    if b and b.ws: b.ws.close()
            except Exception as e:
                self._cors(400, {"error": str(e)})

    def do_GET(self):
        # TX Hũ routes
        if self.path == '/api/68gb/txhu':
            if not bot_txhu or not bot_txhu.last_result: return self._cors(404, {"error": "No TXHU data"})
            return self._cors(200, bot_txhu.last_result)
        elif self.path == '/api/68gb/history/txhu':
            return self._cors(200, bot_txhu.history[::-1] if bot_txhu else [])
        
        # MD5 routes
        elif self.path == '/api/68gb/txmd5':
            if not bot_txmd5 or not bot_txmd5.last_result: return self._cors(404, {"error": "No MD5 data"})
            return self._cors(200, bot_txmd5.last_result)
        elif self.path == '/api/68gb/history/txmd5':
            return self._cors(200, bot_txmd5.history[::-1] if bot_txmd5 else [])
        
        # General endpoints
        elif self.path == '/api/history': # Default to TXHU history for legacy compatibility
             return self._cors(200, bot_txhu.history[::-1] if bot_txhu else [])
        # Force refresh token
        elif self.path == '/api/refetch':
            trigger_auto_fetch()
            return self._cors(200, {"status": "triggered"})
        elif self.path == '/':
            return self._cors(200, {"status": "running", "txhu": bot_txhu.is_alive() if bot_txhu else False, "md5": bot_txmd5.is_alive() if bot_txmd5 else False})
        self._cors(404)

    def _cors(self, code, body=None):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Content-Type", "application/json")
        self.end_headers()
        if body is not None: self.wfile.write(json.dumps(body, ensure_ascii=False).encode('utf-8'))

    def log_message(self, *_): pass

# ─── BASE BOT ────────────────────────────────────────────────────────────────
class BaseBot:
    def __init__(self, name, routes):
        self.name = name
        self.routes = routes
        self.ws = None
        self.auth_done = False
        self.req_id = random.randint(10, 100)
        self.last_result_time = time.time()
        self.history = []
        self.last_result = None
        self.last_sig = ""
        self.prev_session = 0

    def is_alive(self):
        try: return self.ws is not None and self.ws.sock and self.ws.sock.connected
        except: return False

    def _make_packet(self, route, body="{}"):
        rb = route.encode(); bb = body.encode()
        self.req_id = (self.req_id + 1) % 65535
        def varint(n):
            res = bytearray()
            while n > 127: res.append((n & 0x7f) | 0x80); n >>= 7
            res.append(n & 0x7f); return bytes(res)
        msg = b'\x00' + varint(self.req_id) + struct.pack("!B", len(rb)) + rb + bb
        return struct.pack("!BBH", 0x04, 0, len(msg)) + msg

    def on_message(self, ws, message):
        if not isinstance(message, bytes): return
        if message[:1] == b'\x01': ws.send(PKT_HANDSHAKE_ACK, opcode=websocket.ABNF.OPCODE_BINARY)
        elif message[:1] == b'\x04': 
            try: self._parse(message)
            except: pass

    def run_forever(self):
        headers = {
            "Origin": "https://68gbvn88.bar", 
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
        }
        while True:
            self.auth_done = False
            try:
                self.ws = websocket.WebSocketApp(WS_URL, header=headers,
                                                 on_open=lambda ws: ws.send(PKT_HANDSHAKE, opcode=websocket.ABNF.OPCODE_BINARY),
                                                 on_message=self.on_message)
                self.ws.run_forever(ping_interval=20, ping_timeout=10)
            except: pass
            
            # Nếu chạy lặp mà chưa auth được -> Có thể token chết -> Tự fetch
            if not self.auth_done and not os.environ.get("RENDER"):
                trigger_auto_fetch()
                time.sleep(15)
            else:
                time.sleep(5)

    def _auth_flow(self):
        if self.auth_done: return
        time.sleep(0.5); self.ws.send(PKT_AUTH, opcode=websocket.ABNF.OPCODE_BINARY)
        for r in self.routes:
            time.sleep(0.2); self.ws.send(self._make_packet(r), opcode=websocket.ABNF.OPCODE_BINARY)
        self.auth_done = True; self.last_result_time = time.time()
        print(f"✅ [{self.name}] Auth Success!")

# ─── BOT TX HŨ ───────────────────────────────────────────────────────────────
class BotTXHu(BaseBot):
    def __init__(self):
        super().__init__("TXHU", ["lobby.account.getgamelist", "mnshaibao.mnshaibaohandler.entergameroom", "mnshaibao.mnshaibaohandler.getgamescene"])
        
    def _parse(self, raw):
        import re
        if b'mnshaibao' in raw: self._auth_flow() # Tự nhận diện gói tin enter room thành công
        
        # Phân tích TX HŨ (tương tự bot68gb_txhu.py)
        # Check spam
        if b'broadhallmessage' in raw or b'mnsbuserbet' in raw: return
        
        text = raw.decode("utf-8", errors="ignore")
        session = self._find_session(text, raw)
        if session: self.prev_session = session

        # History Sync Fallback
        dice_matches = list(re.finditer(br'\x22\x03([\x02\x04\x06\x08\x0a\x0c])([\x02\x04\x06\x08\x0a\x0c])([\x02\x04\x06\x08\x0a\x0c])', raw))
        if session and dice_matches:
            last_p = self.history[-1]["Phiên trước"] if self.history else (session - 5)
            for i in reversed(range(min(4, len(dice_matches)))):
                s = session - 1 - i
                if s > last_p:
                    m = dice_matches[-(i+1)]
                    self._emit(s, m.group(1)[0]//2, m.group(2)[0]//2, m.group(3)[0]//2)

        if b'mnsbgameend' in raw and session:
            m = re.search(br'\x0a\x03([\x02\x04\x06\x08\x0a\x0c])([\x02\x04\x06\x08\x0a\x0c])([\x02\x04\x06\x08\x0a\x0c])', raw[raw.find(b'mnsbgameend'):])
            if m: self._emit(session, m.group(1)[0]//2, m.group(2)[0]//2, m.group(3)[0]//2)

    def _find_session(self, text, raw):
        m = re.search(r'#(\d{5,8})', text)
        if m: 
            v = int(m.group(1))
            if self.prev_session and (self.prev_session-5 <= v <= self.prev_session+10): return v
            if not self.prev_session and 260000 < v < 300000: return v
        return None

    def _emit(self, s, d1, d2, d3):
        sig = f"{s}_{d1}{d2}{d3}"
        if self.last_sig == sig: return
        self.last_sig = sig; total = d1+d2+d3; res = "TÀI" if total > 10 else "XỈU"
        data = {"Phiên trước": s, "xúc xắc 1": d1, "xúc xắc 2": d2, "xúc xắc 3": d3, "kết quả": res, "time": datetime.now().strftime("%H:%M:%S")}
        self.last_result = data; self.history.append(data)
        if len(self.history) > 300: self.history.pop(0)
        print(f"🎰 [TXHU] #{s} | {total} {res} | {d1}-{d2}-{d3}")

# ─── BOT TX MD5 ──────────────────────────────────────────────────────────────
class BotTXMD5(BaseBot):
    def __init__(self):
        super().__init__("MD5", ["lobby.account.getgamelist", "mnmdsb.mnmdsbhandler.entergameroom", "mnmdsb.mnmdsbhandler.getgamescene"])
        self.current_md5 = ""
        self.pending = None

    def _parse(self, raw):
        import re
        if b'mnmdsbhandler' in raw: self._auth_flow()
        text = raw.decode("utf-8", errors="ignore")
        
        # MD5 String detection
        md5_m = re.search(r'([a-fA-F0-9]{32})', text)
        if md5_m:
            nm = md5_m.group(1)
            if nm != self.current_md5:
                self.current_md5 = nm
                if self.pending:
                    self.pending["chuỗi md5"] = nm
                    self.last_result = self.pending; self.history.append(self.pending)
                    if len(self.history) > 300: self.history.pop(0)
                    self.pending = None

        m = re.search(r'(\d)[-,\s]+(\d)[-,\s]+(\d)', text)
        if m:
            d1, d2, d3 = int(m.group(1)), int(m.group(2)), int(m.group(3))
            ids = re.search(r'#(\d{5,8})', text)
            if ids:
                s = int(ids.group(1))
                if self.last_sig != f"{s}_{d1}{d2}{d3}":
                    self.last_sig = f"{s}_{d1}{d2}{d3}"; total = d1+d2+d3; res = "TÀI" if total > 10 else "XỈU"
                    self.pending = {"Phiên trước": s, "xúc xắc 1": d1, "xúc xắc 2": d2, "xúc xắc 3": d3, "kết quả": res, "chuỗi md5": self.current_md5, "time": datetime.now().strftime("%H:%M:%S")}
                    print(f"🎲 [MD5] #{s} | {total} {res} | {d1}-{d2}-{d3}")

# ─── LAUNCHER ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    global bot_txhu, bot_txmd5
    bot_txhu = BotTXHu()
    bot_txmd5 = BotTXMD5()
    
    server = http.server.HTTPServer(("0.0.0.0", PORT), UnifiedHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"🚀 [SERVER] Unified API on Port {PORT}")

    t1 = threading.Thread(target=bot_txhu.run_forever, daemon=True)
    t2 = threading.Thread(target=bot_txmd5.run_forever, daemon=True)
    t1.start(); t2.start()
    
    while True: time.sleep(10)
