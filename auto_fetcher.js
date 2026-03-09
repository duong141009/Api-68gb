const puppeteer = require('puppeteer'); // Dùng puppeteer (không phải core) để tự tải chromium
const fs = require('fs');

const GAME_URL = "https://68gbvn88.bar/";
const BOT_SERVER = process.env.BOT_SERVER || "http://localhost:8080/api/token";

async function fetchToken() {
    console.log("🚀 [FETCH-JS] Khởi động trình duyệt...");

    let browser;
    try {
        const isRender = process.env.RENDER || false;

        const launchOptions = {
            headless: "new",
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--disable-extensions',
                '--disable-infobars',
                '--window-position=0,0',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list'
            ],
            defaultViewport: { width: 1280, height: 720 }
        };

        // Ưu tiên path trên Render/Docker pptr image
        const paths = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'];
        for (const p of paths) {
            if (fs.existsSync(p)) {
                launchOptions.executablePath = p;
                break;
            }
        }

        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36");

        // Bắt sự kiện WebSocket qua CDP
        const client = await page.target().createCDPSession();
        await client.send('Network.enable');

        let captured_ws_url = null;
        client.on('Network.webSocketCreated', (params) => {
            console.log(`🔗 [FETCH-JS] Phát hiện WebSocket: ${params.url}`);
            captured_ws_url = params.url;
        });

        client.on('Network.webSocketFrameSent', async (params) => {
            const payload = params.response.payloadData;
            const buffer = Buffer.from(payload, 'base64');

            // LOG TẤT CẢ GÓI TIN ĐI ĐỂ DEBUG (CHỈ LOG 10 BYTE ĐẦU)
            console.log(`📡 [SENT] Type: 0x${buffer[0].toString(16).padStart(2, '0')}, Len: ${buffer.length}, Hex: ${buffer.slice(0, 10).toString('hex')}...`);

            if (buffer.length > 50 && buffer[0] === 0x04) {
                const hex = buffer.toString('hex');
                console.log("✅ [FETCH-JS] Bắt được Token! Đợi 5s để ổn định cookie...");

                setTimeout(async () => {
                    try {
                        const cookies = await page.cookies();
                        console.log(`📡 [FETCH-JS] Số lượng cookie captured: ${cookies.length}`);
                        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

                        const response = await fetch(BOT_SERVER, {
                            method: 'POST',
                            body: JSON.stringify({
                                token: hex,
                                ws_url: captured_ws_url,
                                cookies: cookieStr
                            }),
                            headers: { 'Content-Type': 'application/json' }
                        });
                        const res = await response.json();
                        console.log("🤖 [BOT] Phản hồi:", res);
                        if (res.status === "ok") {
                            console.log("🏁 [FINISH] Hoàn tất!");
                            process.exit(0);
                        }
                    } catch (e) {
                        console.error("❌ [ERROR] Lỗi gửi token/cookie:", e.message);
                    }
                }, 5000);
            }
        });

        console.log("📡 [FETCH-JS] Đang tải game...");
        await page.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 90000 });
        console.log("✅ [FETCH-JS] Trang đã tải xong (networkidle2).");

        // Safety EXIT after 5 minutes if still stuck
        const safetyFinal = setTimeout(() => {
            console.log("💀 [CRITICAL] Token fetcher stuck too long (300s). Exiting.");
            process.exit(1);
        }, 300000);

        // Click phá popup - Loop nhiều lần ở nhiều tọa độ
        console.log("🖱️ [FETCH-JS] Khởi động tương tác giả lập...");
        const clicks = [
            { x: 640, y: 360 }, // Tâm
            { x: 640, y: 500 }, // Hơi thấp
            { x: 100, y: 100 }, // Góc
            { x: 1100, y: 600 } // Góc
        ];

        for (const pos of clicks) {
            await page.mouse.click(pos.x, pos.y);
            console.log(`🖱️ [FETCH-JS] Click tại [${pos.x}, ${pos.y}]`);
            await new Promise(r => setTimeout(r, 2000));
        }

        console.log("⏳ [FETCH-JS] Đang đợi WebSocket Auth sinh ra (đợi 20s)...");
        await new Promise(r => setTimeout(r, 20000));

        // Timeout 4 phút
        setTimeout(() => {
            console.log("⏰ [TIMEOUT] Không bắt được token sau 4 phút.");
            process.exit(1);
        }, 240000);

    } catch (err) {
        console.error("❌ [FETCH-JS] Lỗi:", err.message);
        process.exit(1);
    }
}

fetchToken();
