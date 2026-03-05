function getCurrentTime() {
    return new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }).replace(',', '');
}

let history = [];
let fullHistory = [];

let latestResult = {
    "Phiên trước": 0,
    "xúc xắc 1": 0,
    "xúc xắc 2": 0,
    "xúc xắc 3": 0,
    "kết quả": 0,
    "pattern": "",
    "phiên hiện tại": 0,
    "chuỗi md5": "",
    "time": getCurrentTime(),
    "id": "Dwong1410"
};

function getTaiXiu(sum) {
    return sum > 10 ? "t" : "x";
}

function updateData(d1, d2, d3, sid) {
    const total = d1 + d2 + d3;
    const shorthand = getTaiXiu(total);

    if (sid !== latestResult["Phiên trước"]) {
        history.push(shorthand);
        if (history.length > 20) history.shift();

        const pattern = history.join("");
        const timeStr = getCurrentTime();

        latestResult = {
            "Phiên trước": sid,
            "xúc xắc 1": d1,
            "xúc xắc 2": d2,
            "xúc xắc 3": d3,
            "kết quả": total,
            "pattern": pattern,
            "phiên hiện tại": sid + 1,
            "chuỗi md5": "",
            "time": timeStr,
            "id": "Dwong1410"
        };

        fullHistory.push(latestResult);
        if (fullHistory.length > 300) fullHistory.shift();

        console.log(`[🎲 HU] Phiên ${sid} - ${d1}-${d2}-${d3} ➜ Tổng: ${total} | ${timeStr}`);
    }
}

module.exports = {
    updateData,
    getCurrentData: () => latestResult,
    getHistory: (limitStr) => {
        let limit = fullHistory.length;
        if (limitStr) {
            const parsedLimit = parseInt(limitStr);
            if (!isNaN(parsedLimit) && parsedLimit > 0) {
                limit = Math.min(parsedLimit, 300, fullHistory.length);
            }
        } else {
            limit = Math.min(300, fullHistory.length);
        }
        return fullHistory.slice(-limit);
    }
};
