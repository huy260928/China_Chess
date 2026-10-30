"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - MASTER OPENING BOOK (KHAI CUỘC MẪU CỜ TƯỚNG)
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNormalizedFenKey = getNormalizedFenKey;
exports.lookupOpeningBookMove = lookupOpeningBookMove;
/**
 * Extracts normalized position key "<board_layout> <active_side>" from a full FEN.
 */
function getNormalizedFenKey(fen) {
    const parts = fen.trim().split(/\s+/);
    return `${parts[0]} ${parts[1].toLowerCase() === 'b' ? 'b' : 'w'}`;
}
/**
 * Opening Book mapping normalized FEN keys to weighted candidate moves:
 * Includes Pháo Đầu - Bình Phong Mã, Thuận Pháo, Nghịch Pháo, Phi Tượng Cuộc, Tiên Nhân Chỉ Lộ.
 */
const OPENING_BOOK_TABLE = {
    // 1. Khởi cuộc Tiên (Red Move 1)
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w': [
        {
            move: { from: { row: 7, col: 7 }, to: { row: 7, col: 4 } },
            weight: 45,
            name: 'Trung Pháo (Pháo 2 bình 5)',
        },
        {
            move: { from: { row: 7, col: 1 }, to: { row: 7, col: 4 } },
            weight: 25,
            name: 'Trung Pháo (Pháo 8 bình 5)',
        },
        {
            move: { from: { row: 6, col: 2 }, to: { row: 5, col: 2 } },
            weight: 12,
            name: 'Tiên Nhân Chỉ Lộ (Tốt 7 tiến 1)',
        },
        {
            move: { from: { row: 9, col: 6 }, to: { row: 7, col: 4 } },
            weight: 10,
            name: 'Phi Tượng Cuộc (Tượng 3 tiến 5)',
        },
        {
            move: { from: { row: 9, col: 7 }, to: { row: 7, col: 6 } },
            weight: 8,
            name: 'Khởi Mã Cuộc (Mã 2 tiến 3)',
        },
    ],
    // 2. Đen đỡ Pháo 2 bình 5 (Black Move 1 vs C2.5) -> Bình Phong Mã / Thuận Pháo / Nghịch Pháo
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b': [
        {
            move: { from: { row: 0, col: 7 }, to: { row: 2, col: 6 } },
            weight: 60,
            name: 'Bình Phong Mã (Mã 8 tiến 7)',
        },
        {
            move: { from: { row: 2, col: 7 }, to: { row: 2, col: 4 } },
            weight: 25,
            name: 'Thuận Pháo (Pháo 8 bình 5)',
        },
        {
            move: { from: { row: 2, col: 1 }, to: { row: 2, col: 4 } },
            weight: 15,
            name: 'Nghịch Pháo (Pháo 2 bình 5)',
        },
    ],
    // 3. Đen đỡ Pháo 8 bình 5 (Black Move 1 vs C8.5)
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/4C2C1/9/RNBAKABNR b': [
        {
            move: { from: { row: 0, col: 1 }, to: { row: 2, col: 2 } },
            weight: 60,
            name: 'Bình Phong Mã (Mã 2 tiến 3)',
        },
        {
            move: { from: { row: 2, col: 1 }, to: { row: 2, col: 4 } },
            weight: 25,
            name: 'Thuận Pháo (Pháo 2 bình 5)',
        },
        {
            move: { from: { row: 2, col: 7 }, to: { row: 2, col: 4 } },
            weight: 15,
            name: 'Nghịch Pháo (Pháo 8 bình 5)',
        },
    ],
    // 4. Đỏ đi nước 2 sau C2.5 n8+7 -> Mã 2 tiến 3 (N2+3)
    'rnbakab1r/9/1c4nc1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR w': [
        {
            move: { from: { row: 9, col: 7 }, to: { row: 7, col: 6 } },
            weight: 85,
            name: 'Trung Pháo Chính Mã (Mã 2 tiến 3)',
        },
        {
            move: { from: { row: 6, col: 2 }, to: { row: 5, col: 2 } },
            weight: 15,
            name: 'Tiên Nhân Chỉ Lộ (Tốt 7 tiến 1)',
        },
    ],
    // 5. Đen đi nước 2 sau C2.5 n8+7 / N2+3 -> Tốt 7 tiến 1 hoặc Mã 2 tiến 3 (Hoàn chỉnh Bình Phong Mã)
    'rnbakab1r/9/1c4nc1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C1N2/9/RNBAKAB1R b': [
        {
            move: { from: { row: 3, col: 6 }, to: { row: 4, col: 6 } },
            weight: 50,
            name: 'Bình Phong Mã Khởi Tốt 7 (Tốt 7 tiến 1)',
        },
        {
            move: { from: { row: 0, col: 1 }, to: { row: 2, col: 2 } },
            weight: 50,
            name: 'Song Chính Mã Bình Phong (Mã 2 tiến 3)',
        },
    ],
    // 6. Đỏ đi nước 3 sau C2.5 n8+7 / N2+3 p7+1 -> Xe 1 bình 2 (R1.2)
    'rnbakab1r/9/1c4nc1/p1p1p3p/6p2/9/P1P1P1P1P/1C2C1N2/9/RNBAKAB1R w': [
        {
            move: { from: { row: 9, col: 8 }, to: { row: 9, col: 7 } },
            weight: 80,
            name: 'Trực Xe (Xe 1 bình 2)',
        },
        {
            move: { from: { row: 9, col: 1 }, to: { row: 7, col: 2 } },
            weight: 20,
            name: 'Song Chính Mã (Mã 8 tiến 7)',
        },
    ],
    // 7. Đỏ đi nước 3 sau C2.5 n8+7 / N2+3 n2+3 -> Xe 1 bình 2 (R1.2)
    'r1bakab1r/9/1cn3nc1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C1N2/9/RNBAKAB1R w': [
        {
            move: { from: { row: 9, col: 8 }, to: { row: 9, col: 7 } },
            weight: 70,
            name: 'Trực Xe (Xe 1 bình 2)',
        },
        {
            move: { from: { row: 6, col: 2 }, to: { row: 5, col: 2 } },
            weight: 30,
            name: 'Thúc Tốt 7 (Tốt 7 tiến 1)',
        },
    ],
    // 8. Đen đi nước 3 sau C2.5 n8+7 / N2+3 p7+1 / R1.2 -> Mã 2 tiến 3 (n2+3)
    'rnbakab1r/9/1c4nc1/p1p1p3p/6p2/9/P1P1P1P1P/1C2C1N2/9/RNBAKABR1 b': [
        {
            move: { from: { row: 0, col: 1 }, to: { row: 2, col: 2 } },
            weight: 75,
            name: 'Bình Phong Mã Hoàn Chỉnh (Mã 2 tiến 3)',
        },
        {
            move: { from: { row: 0, col: 8 }, to: { row: 0, col: 7 } },
            weight: 25,
            name: 'Xuất Trực Xe (Xe 9 bình 8)',
        },
    ],
    // 9. Đen đỡ Tiên Nhân Chỉ Lộ (P7+1) -> Đối Binh Cuộc hoặc Pháo Đầu / Khởi Mã
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/2P6/P3P1P1P/1C5C1/9/RNBAKABNR b': [
        {
            move: { from: { row: 2, col: 7 }, to: { row: 2, col: 2 } },
            weight: 45,
            name: 'Tốt Đề Pháo (Pháo 8 bình 3)',
        },
        {
            move: { from: { row: 3, col: 6 }, to: { row: 4, col: 6 } },
            weight: 35,
            name: 'Đối Binh Cuộc (Tốt 7 tiến 1)',
        },
        {
            move: { from: { row: 0, col: 7 }, to: { row: 2, col: 6 } },
            weight: 20,
            name: 'Khởi Mã (Mã 8 tiến 7)',
        },
    ],
    // 10. Đen đỡ Phi Tượng Cuộc (B3+5) -> Tả Trung Pháo hoặc Tiến Tốt
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2B2C1/9/RNBAK1BNR b': [
        {
            move: { from: { row: 2, col: 1 }, to: { row: 2, col: 4 } },
            weight: 50,
            name: 'Tả Trung Pháo Phá Phi Tượng (Pháo 2 bình 5)',
        },
        {
            move: { from: { row: 3, col: 2 }, to: { row: 4, col: 2 } },
            weight: 30,
            name: 'Tiến Tốt Chế Mã (Tốt 3 tiến 1)',
        },
        {
            move: { from: { row: 0, col: 1 }, to: { row: 2, col: 2 } },
            weight: 20,
            name: 'Khởi Mã (Mã 2 tiến 3)',
        },
    ],
};
/**
 * Looks up a weighted move from the Opening Book for the given engine position.
 * Validates legality before returning.
 */
function lookupOpeningBookMove(engine) {
    const key = getNormalizedFenKey(engine.generateFen());
    const candidates = OPENING_BOOK_TABLE[key];
    if (!candidates || candidates.length === 0) {
        return null;
    }
    const validCandidates = candidates.filter((entry) => engine.isValidMove(entry.move));
    if (validCandidates.length === 0) {
        return null;
    }
    const totalWeight = validCandidates.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const entry of validCandidates) {
        roll -= entry.weight;
        if (roll <= 0) {
            return entry.move;
        }
    }
    return validCandidates[0].move;
}
//# sourceMappingURL=opening-book.js.map