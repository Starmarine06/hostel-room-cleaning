// Room numbers look like "T-230": a block code, a dash, then the room number.
const ROOM_PATTERN = /^([A-Z0-9]{1,4})-(\d{1,4})$/;

export interface ParsedRoom {
  number: string;
  building: string;
  floor: number;
}

export function parseRoomNumber(input: string): ParsedRoom | null {
  const match = ROOM_PATTERN.exec(input.trim().toUpperCase().replace(/\s+/g, ''));
  if (!match) return null;
  const [, block, digits] = match;
  return {
    number: `${block}-${digits}`,
    building: block,
    // 230 -> floor 2, 105 -> floor 1, 12 -> ground floor (0)
    floor: Math.floor(Number(digits) / 100),
  };
}
