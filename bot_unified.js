const WebSocket = require('ws');

class Bot68GB {
    constructor(shared) {
        this.shared = shared;
        this.name = "ULTIMATE-BOT";
        this.ws = null;
        this.auth_done = false;
        this.req_id = Math.floor(Math.random() * 1000) + 500;

        this.txhu = { history: [], last_result: null, last_sig: "", prev_session: 0, last_msg: Date.now() };
        this.md5 = { history: [], last_result: null, last_sig: "", prev_session: 0, last_msg: Date.now(), current_md5: "" };

        this.reconnect_delay = 1000;
        this.max_reconnect_delay = 30000;
        this.auth_timeout = null;
    }

    _makePacket(route, body = "{}") {
        const rb = Buffer.from(route);
        const bb = Buffer.from(body);
        this.req_id = (this.req_id + 1) % 65535;
        const varint = (n) => {
            const res = [];
            while (n > 127) { res.push((n & 0x7f) | 0x80); n >>>= 7; }
            res.push(n & 0x7f); return Buffer.from(res);
        };
        const msg = Buffer.concat([Buffer.from([0x00]), varint(this.req_id), Buffer.from([rb.length]), rb, bb]);
        const header = Buffer.alloc(4);
        header.writeUInt8(0x04, 0); header.writeUInt8(0, 1);
        header.writeUInt16BE(msg.length, 2);
        return Buffer.concat([header, msg]);
    }

    _authFlow() {
        if (this.auth_done) return;
        console.log(`🚀 [AUTH] Khởi động...`);
        if (this.auth_timeout) clearTimeout(this.auth_timeout);
        this.auth_timeout = setTimeout(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            this.ws.send(this.shared.PKT_AUTH);

            const routes = [
                "lobby.account.getgamelist",
                "mnshaibao.mnshaibaohandler.entergameroom",
                "mnshaibao.mnshaibaohandler.getgamescene",
                "mnmdsb.mnmdsbhandler.entergameroom",
                "mnmdsb.mnmdsbhandler.getgamescene"
            ];

            routes.forEach((r, i) => {
                setTimeout(() => {
                    if (this.ws && this.ws.readyState === WebSocket.OPEN)
                        this.ws.send(this._makePacket(r));
                }, 400 * (i + 1));
            });

            // Clear previous completion timeout if any
            if (this.auth_done_timeout) clearTimeout(this.auth_done_timeout);
            this.auth_done_timeout = setTimeout(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.auth_done = true;
                    this.reconnect_delay = 1000; // Reset delay when auth succeeds
                    console.log("✅ [AUTH] Hoàn tất!");
                }
            }, 6000);
        }, 1000);
    }

    run() {
        this.req_id = Math.floor(Math.random() * 1000) + 500; // Reset req_id on start
        const headers = {
            "Origin": "https://68gbvn88.bar",
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
            "Cookie": this.shared.COOKIES || ""
        };
        this.ws = new WebSocket(this.shared.WS_URL, { headers });

        this.ws.on('open', () => {
            console.log(`🌐 [WS] Connected.`);
            this.txhu.last_msg = Date.now(); // Reset timestamp khi mới kết nối
            this.md5.last_msg = Date.now();
            this.ws.send(this.shared.PKT_HANDSHAKE);
            this.heartbeat = setInterval(() => {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(this.shared.PKT_HEARTBEAT);
                    this.ws.send(this._makePacket("gamecen.gamecenter.queryjackpot"));

                    const now = Date.now();

                    // Kiểm tra im lặng tuyệt đối (không có bất kỳ message nào trong 60s)
                    const lastAny = Math.max(this.txhu.last_msg, this.md5.last_msg);
                    if (now - lastAny > 60000) {
                        console.log("💀 [WS] Tuyệt đối im lặng (>60s). Đang ép kết nối lại...");
                        this.ws.close();
                        return;
                    }

                    if (this.auth_done) {
                        // Tách riêng check stale cho từng game
                        if (now - this.txhu.last_msg > 35000) {
                            console.log(`📡 [WS] TX Hũ data stale (>35s). Re-entering...`);
                            ["mnshaibao.mnshaibaohandler.entergameroom", "mnshaibao.mnshaibaohandler.getgamescene"].forEach((r, i) => {
                                setTimeout(() => { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(this._makePacket(r)); }, 300 * i);
                            });
                            this.txhu.last_msg = now; // Tránh spam re-entry
                        }

                        if (now - this.md5.last_msg > 35000) {
                            console.log(`📡 [WS] TX MD5 data stale (>35s). Re-entering...`);
                            ["mnmdsb.mnmdsbhandler.entergameroom", "mnmdsb.mnmdsbhandler.getgamescene"].forEach((r, i) => {
                                setTimeout(() => { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(this._makePacket(r)); }, 300 * i);
                            });
                            this.md5.last_msg = now;
                        }
                    }
                }
            }, 10000);
        });

        this.ws.on('message', (data) => {
            if (!Buffer.isBuffer(data)) return;
            if (data[0] === 0x01) {
                this.ws.send(this.shared.PKT_HANDSHAKE_ACK);
                this._authFlow();
            } else if (data[0] === 0x04) {
                this._parse(data);
            } else if (data[0] === 0x05) {
                console.log(`⚠️ [WS] Bị KICK.`);
                this.ws.close();
            } else {
                // Log unhandled packet types once to see if server sends error/info
                if (!this._logged_types) this._logged_types = new Set();
                if (!this._logged_types.has(data[0])) {
                    console.log(`ℹ️ [WS] Nhận packet loại: 0x${data[0].toString(16).padStart(2, '0')}`);
                    this._logged_types.add(data[0]);
                }
            }
        });

        this.ws.on('close', (code, reason) => {
            console.log(`🔌 [WS] Closed. Code: ${code}, Reason: ${reason}`);
            this.auth_done = false;
            if (this.heartbeat) clearInterval(this.heartbeat);
            if (this.auth_timeout) clearTimeout(this.auth_timeout);
            if (this.auth_done_timeout) clearTimeout(this.auth_done_timeout);
            this._logged_types = null;

            console.log(`🔁 [WS] Reconnecting in ${this.reconnect_delay / 1000}s...`);
            setTimeout(() => {
                this.reconnect_delay = Math.min(this.reconnect_delay * 1.5, this.max_reconnect_delay);
                this.run();
            }, this.reconnect_delay);
        });
    }

    _findSession(raw, game) {
        const text = raw.toString('utf8', 0, 512);
        const m = /#(\d{5,10})/.exec(text);
        if (m) return parseInt(m[1]);

        // Brute force varint scan
        const body = raw.slice(4);
        for (let i = 0; i < Math.min(body.length - 4, 150); i++) {
            if (body[i] === 0x28 || body[i] === 0x38) { // Tag 5 hoặc Tag 7
                let val = 0, sh = 0;
                for (let j = 1; j < 6; j++) {
                    if (i + j >= body.length) break;
                    let b = body[i + j];
                    val |= (b & 0x7f) << sh;
                    if (!(b & 0x80)) {
                        let s = (body[i] === 0x38) ? (val >> 1) : val;
                        if (game === 'txhu' && s > 200000) return s;
                        if (game === 'md5' && s > 40000 && s < 100000) return s;
                        break;
                    }
                    sh += 7;
                }
            }
        }
        return game === 'txhu' ? this.txhu.prev_session : this.md5.prev_session;
    }

    _parse(raw) {
        if (raw.length < 30 && raw.includes('userbet')) return;

        const rawBin = raw.toString('binary');
        const text = raw.toString('utf8', 0, 1024);

        if (raw.includes('mnsb') || raw.includes('mnshaibao')) {
            this.txhu.last_msg = Date.now();
            const s = this._findSession(raw, 'txhu');
            if (s > 200000) this.txhu.prev_session = s;

            // Binary Dice
            const m = /\x0a\x03([\x02\x04\x06\x08\x0a\x0c])([\x02\x04\x06\x08\x0a\x0c])([\x02\x04\x06\x08\x0a\x0c])/.exec(rawBin);
            if (m && this.txhu.prev_session) this._emit('HŨ', this.txhu.prev_session, m[1].charCodeAt(0) / 2, m[2].charCodeAt(0) / 2, m[3].charCodeAt(0) / 2);

            // Scene History
            const hm = /\x22\x03([\x02\x04\x06\x08\x0a\x0c])([\x02\x04\x06\x08\x0a\x0c])([\x02\x04\x06\x08\x0a\x0c])/g;
            let mt, matched = [];
            while ((mt = hm.exec(rawBin)) !== null) matched.push(mt);
            if (this.txhu.prev_session && matched.length > 0) {
                matched.slice(-10).forEach((mt, i) => {
                    const hs = this.txhu.prev_session - (matched.length - i);
                    this._emit('HŨ', hs, mt[1].charCodeAt(0) / 2, mt[2].charCodeAt(0) / 2, mt[3].charCodeAt(0) / 2);
                });
            }
        }

        if (raw.includes('mnmdsb') || text.includes('MD5')) {
            this.md5.last_msg = Date.now();
            const s = this._findSession(raw, 'md5');
            if (s > 40000 && s < 100000) this.md5.prev_session = s;

            const md5M = /([a-fA-F0-9]{32})/.exec(text);
            if (md5M) this.md5.current_md5 = md5M[1];

            // MD5 Dice: Text or Binary
            const tdice = /(\d)[-,\s]+(\d)[-,\s]+(\d)/.exec(text);
            if (tdice && this.md5.prev_session) {
                this._emit('MD5', this.md5.prev_session, parseInt(tdice[1]), parseInt(tdice[2]), parseInt(tdice[3]));
            } else {
                const bdice = /\x0a\x03([\x02\x04\x06\x08\x0a\x0c])([\x02\x04\x06\x08\x0a\x0c])([\x02\x04\x06\x08\x0a\x0c])/.exec(rawBin);
                if (bdice && this.md5.prev_session) this._emit('MD5', this.md5.prev_session, bdice[1].charCodeAt(0) / 2, bdice[2].charCodeAt(0) / 2, bdice[3].charCodeAt(0) / 2);
            }
        }
    }

    _emit(game, s, d1, d2, d3) {
        if (!s || !d1 || !d2 || !d3) return;
        const sig = `${s}_${d1}${d2}${d3}`;
        const target = game === 'HŨ' ? this.txhu : this.md5;
        if (target.last_sig === sig) return;
        target.last_sig = sig;

        const total = d1 + d2 + d3, res = total > 10 ? "TÀI" : "XỈU";
        const entry = { "Phiên trước": s, "xúc xắc 1": d1, "xúc xắc 2": d2, "xúc xắc 3": d3, "kết quả": res, "time": new Date().toLocaleTimeString('vi-VN') };
        if (game === 'MD5') entry["chuỗi md5"] = this.md5.current_md5;

        const hist = game === 'HŨ' ? this.txhu.history : this.md5.history;
        hist.push(entry);
        if (hist.length > 300) hist.shift();
        target.last_result = entry;

        console.log(`🎰 [${game}] #${s} | ${total} ${res} | ${d1}-${d2}-${d3}`);
    }

    isAlive() { return this.ws && this.ws.readyState === WebSocket.OPEN && this.auth_done; }
}

module.exports = Bot68GB;
