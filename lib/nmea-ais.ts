import type { AisEnvelope } from "./ais";

const SIX_BIT_TEXT = (value: number) => String.fromCharCode(value < 32 ? value + 64 : value + 32);

function payloadBits(payload: string, fillBits: number) {
  let bits = "";
  for (const character of payload) {
    let value = character.charCodeAt(0) - 48;
    if (value > 40) value -= 8;
    bits += value.toString(2).padStart(6, "0");
  }
  return fillBits > 0 ? bits.slice(0, -fillBits) : bits;
}

function unsigned(bits: string, start: number, length: number) {
  return Number.parseInt(bits.slice(start, start + length) || "0", 2);
}

function signed(bits: string, start: number, length: number) {
  const value = unsigned(bits, start, length);
  return bits[start] === "1" ? value - 2 ** length : value;
}

function sixBitText(bits: string, start: number, length: number) {
  let value = "";
  for (let offset = 0; offset < length; offset += 6) {
    value += SIX_BIT_TEXT(unsigned(bits, start + offset, 6));
  }
  return value.replaceAll("@", " ").replace(/\s+/g, " ").trim();
}

function positionEnvelope(bits: string, messageType: number, provider: string): AisEnvelope | undefined {
  const mmsi = unsigned(bits, 8, 30);
  let latitude: number;
  let longitude: number;
  let sog: number;
  let cog: number;
  let heading: number | undefined;
  let navStatus = 15;

  if ([1, 2, 3].includes(messageType)) {
    navStatus = unsigned(bits, 38, 4);
    sog = unsigned(bits, 50, 10) / 10;
    longitude = signed(bits, 61, 28) / 600_000;
    latitude = signed(bits, 89, 27) / 600_000;
    cog = unsigned(bits, 116, 12) / 10;
    const rawHeading = unsigned(bits, 128, 9);
    if (rawHeading < 360) heading = rawHeading;
  } else if ([18, 19].includes(messageType)) {
    sog = unsigned(bits, 46, 10) / 10;
    longitude = signed(bits, 57, 28) / 600_000;
    latitude = signed(bits, 85, 27) / 600_000;
    cog = unsigned(bits, 112, 12) / 10;
    const rawHeading = unsigned(bits, 124, 9);
    if (rawHeading < 360) heading = rawHeading;
  } else if (messageType === 27) {
    navStatus = unsigned(bits, 38, 4);
    longitude = signed(bits, 44, 18) / 600;
    latitude = signed(bits, 62, 17) / 600;
    sog = unsigned(bits, 79, 6);
    cog = unsigned(bits, 85, 9);
  } else {
    return undefined;
  }

  if (!mmsi || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || sog >= 102.3 || cog >= 360) return undefined;
  return {
    MessageType: "PositionReport",
    MetaData: { MMSI: mmsi, Provider: provider },
    Message: { PositionReport: {
      UserID: mmsi,
      Latitude: latitude,
      Longitude: longitude,
      Sog: sog,
      Cog: cog,
      TrueHeading: heading,
      NavigationalStatus: navStatus,
    } },
  };
}

function staticEnvelope(bits: string, messageType: number, provider: string): AisEnvelope | undefined {
  const mmsi = unsigned(bits, 8, 30);
  if (!mmsi) return undefined;
  if (messageType === 5) {
    return {
      MessageType: "ShipStaticData",
      MetaData: { MMSI: mmsi, Provider: provider },
      Message: { ShipStaticData: {
        UserID: mmsi,
        ImoNumber: unsigned(bits, 40, 30),
        CallSign: sixBitText(bits, 70, 42),
        Name: sixBitText(bits, 112, 120),
        Type: unsigned(bits, 232, 8),
        Dimension: {
          A: unsigned(bits, 240, 9), B: unsigned(bits, 249, 9),
          C: unsigned(bits, 258, 6), D: unsigned(bits, 264, 6),
        },
        MaximumStaticDraught: unsigned(bits, 294, 8) / 10,
        Destination: sixBitText(bits, 302, 120),
      } },
    };
  }
  if (messageType === 19) {
    return {
      MessageType: "ShipStaticData",
      MetaData: { MMSI: mmsi, Provider: provider },
      Message: { ShipStaticData: {
        UserID: mmsi,
        Name: sixBitText(bits, 143, 120),
        Type: unsigned(bits, 263, 8),
        Dimension: {
          A: unsigned(bits, 271, 9), B: unsigned(bits, 280, 9),
          C: unsigned(bits, 289, 6), D: unsigned(bits, 295, 6),
        },
      } },
    };
  }
  if (messageType === 24) {
    const part = unsigned(bits, 38, 2);
    if (part === 0) {
      return {
        MessageType: "ShipStaticData",
        MetaData: { MMSI: mmsi, Provider: provider },
        Message: { ShipStaticData: { UserID: mmsi, Name: sixBitText(bits, 40, 120) } },
      };
    }
    return {
      MessageType: "ShipStaticData",
      MetaData: { MMSI: mmsi, Provider: provider },
      Message: { ShipStaticData: {
        UserID: mmsi,
        Type: unsigned(bits, 40, 8),
        CallSign: sixBitText(bits, 90, 42),
        Dimension: {
          A: unsigned(bits, 132, 9), B: unsigned(bits, 141, 9),
          C: unsigned(bits, 150, 6), D: unsigned(bits, 156, 6),
        },
      } },
    };
  }
  return undefined;
}

export class NmeaAisDecoder {
  private fragments = new Map<string, { payloads: string[]; fillBits: number; touchedAt: number }>();

  constructor(private readonly provider = "Norwegian Coastal Administration / Kystverket") {}

  decode(line: string): AisEnvelope[] {
    const sentenceStart = line.indexOf("!");
    if (sentenceStart < 0) return [];
    const fields = line.slice(sentenceStart).trim().split(",");
    if (fields.length < 7 || !fields[0].endsWith("VDM")) return [];
    const total = Number(fields[1]);
    const part = Number(fields[2]);
    const sequence = fields[3] || "unsequenced";
    const channel = fields[4] || "unknown";
    const payload = fields[5];
    const fillBits = Number(fields[6].split("*")[0]);
    if (!Number.isInteger(total) || !Number.isInteger(part) || !payload || !Number.isInteger(fillBits)) return [];

    let completePayload = payload;
    let completeFillBits = fillBits;
    if (total > 1) {
      const key = `${fields[0]}:${sequence}:${channel}:${total}`;
      const entry = this.fragments.get(key) ?? { payloads: Array<string>(total), fillBits: 0, touchedAt: Date.now() };
      entry.payloads[part - 1] = payload;
      entry.fillBits = part === total ? fillBits : entry.fillBits;
      entry.touchedAt = Date.now();
      this.fragments.set(key, entry);
      if (entry.payloads.filter(Boolean).length !== total) return [];
      completePayload = entry.payloads.join("");
      completeFillBits = entry.fillBits;
      this.fragments.delete(key);
    }

    if (this.fragments.size > 250) {
      const cutoff = Date.now() - 30_000;
      for (const [key, entry] of this.fragments) if (entry.touchedAt < cutoff) this.fragments.delete(key);
    }

    const bits = payloadBits(completePayload, completeFillBits);
    const messageType = unsigned(bits, 0, 6);
    const position = positionEnvelope(bits, messageType, this.provider);
    const staticData = staticEnvelope(bits, messageType, this.provider);
    return [position, staticData].filter((envelope): envelope is AisEnvelope => Boolean(envelope));
  }
}
