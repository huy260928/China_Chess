import { MoveIntent, XiangqiEngine } from '@xiangqi/shared';
export interface BookEntry {
    move: MoveIntent;
    weight: number;
    name: string;
}
/**
 * Extracts normalized position key "<board_layout> <active_side>" from a full FEN.
 */
export declare function getNormalizedFenKey(fen: string): string;
/**
 * Looks up a weighted move from the Opening Book for the given engine position.
 * Validates legality before returning.
 */
export declare function lookupOpeningBookMove(engine: XiangqiEngine): MoveIntent | null;
//# sourceMappingURL=opening-book.d.ts.map