export type PortSanctuary = {
  name: string;
  locode: string;
  coords: [number, number];
  region: string;
  epithet: string;
  aliases: string[];
  accent: string;
};

export const PORT_SANCTUARIES: PortSanctuary[] = [
  { name: "Helsinki", locode: "FIHEL", coords: [24.95, 60.15], region: "Gulf of Finland", epithet: "The granite lantern", aliases: ["HELSINKI", "FIN HELSINKI", "FIHEL"], accent: "#E2B966" },
  { name: "Kotka", locode: "FIKTK", coords: [26.95, 60.46], region: "Gulf of Finland", epithet: "Harbor of forest cargo", aliases: ["KOTKA", "MUSSALO", "FIKTK"], accent: "#D89060" },
  { name: "Hamina", locode: "FIHMN", coords: [27.19, 60.57], region: "Gulf of Finland", epithet: "The eastern gate", aliases: ["HAMINA", "FIHMN"], accent: "#D8796C" },
  { name: "Turku", locode: "FITKU", coords: [22.21, 60.43], region: "Archipelago Sea", epithet: "City among a thousand islands", aliases: ["TURKU", "ABO", "FITKU"], accent: "#9FC7A9" },
  { name: "Rauma", locode: "FIRAU", coords: [21.45, 61.13], region: "Bothnian Sea", epithet: "The timber star", aliases: ["RAUMA", "FIRAU"], accent: "#D7A65E" },
  { name: "Oulu", locode: "FIOUL", coords: [25.42, 65.01], region: "Bay of Bothnia", epithet: "Northern river mouth", aliases: ["OULU", "FIOUL"], accent: "#A8C9C1" },
  { name: "Kemi", locode: "FIKEM", coords: [24.52, 65.67], region: "Bay of Bothnia", epithet: "The icebound mill harbor", aliases: ["KEMI", "FIKEM"], accent: "#C8D8C9" },
  { name: "Tallinn", locode: "EETLL", coords: [24.76, 59.45], region: "Gulf of Finland", epithet: "The amber crossing", aliases: ["TALLINN", "MUUGA", "EETLL"], accent: "#D7A85F" },
  { name: "Stockholm", locode: "SESTO", coords: [18.10, 59.32], region: "Baltic Sea", epithet: "Harbor through the skerries", aliases: ["STOCKHOLM", "SESTO"], accent: "#D6BB7B" },
  { name: "Oslo", locode: "NOOSL", coords: [10.74, 59.89], region: "Oslofjord", epithet: "The sheltered northern hall", aliases: ["OSLO", "NOOSL"], accent: "#D98D68" },
  { name: "Bergen", locode: "NOBGO", coords: [5.31, 60.39], region: "North Sea", epithet: "The rain-lit quay", aliases: ["BERGEN", "NOBGO"], accent: "#85B8B1" },
  { name: "Stavanger", locode: "NOSVG", coords: [5.73, 58.97], region: "North Sea", epithet: "The offshore threshold", aliases: ["STAVANGER", "TANANGER", "NOSVG"], accent: "#D49B64" },
  { name: "Trondheim", locode: "NOTRD", coords: [10.40, 63.44], region: "Trondheimsfjord", epithet: "Fjord of the old kings", aliases: ["TRONDHEIM", "NOTRD"], accent: "#B9C99B" },
  { name: "Narvik", locode: "NONVK", coords: [17.43, 68.43], region: "Ofotfjord", epithet: "The iron road to the sea", aliases: ["NARVIK", "NONVK"], accent: "#D1875D" },
  { name: "Tromsø", locode: "NOTOS", coords: [18.96, 69.65], region: "Norwegian Sea", epithet: "The aurora harbor", aliases: ["TROMSO", "TROMSØ", "NOTOS"], accent: "#A6D0BB" },
  { name: "Rotterdam", locode: "NLRTM", coords: [4.48, 51.92], region: "North Sea", epithet: "The river gate of Europe", aliases: ["ROTTERDAM", "NLRTM", "EUROPOORT"], accent: "#E2B966" },
  { name: "Singapore", locode: "SGSIN", coords: [103.82, 1.26], region: "Singapore Strait", epithet: "The equatorial crossing", aliases: ["SINGAPORE", "SGSIN"], accent: "#D8796C" },
  { name: "Shanghai", locode: "CNSHA", coords: [121.50, 31.23], region: "East China Sea", epithet: "The river of ten thousand sails", aliases: ["SHANGHAI", "CNSHA"], accent: "#D89060" },
  { name: "Los Angeles", locode: "USLAX", coords: [-118.25, 33.74], region: "Eastern Pacific", epithet: "The Pacific warehouse", aliases: ["LOS ANGELES", "LONG BEACH", "USLAX", "USLGB"], accent: "#D8A35F" },
  { name: "Santos", locode: "BRSSZ", coords: [-46.30, -24.00], region: "South Atlantic", epithet: "The coffee coast", aliases: ["SANTOS", "BRSSZ"], accent: "#C78C62" },
  { name: "Abidjan", locode: "CIABJ", coords: [-4.02, 5.26], region: "Gulf of Guinea", epithet: "The cocoa lagoon", aliases: ["ABIDJAN", "CIABJ"], accent: "#BF875F" },
  { name: "New Orleans", locode: "USMSY", coords: [-89.96, 29.70], region: "Gulf of Mexico", epithet: "The grain river's mouth", aliases: ["NEW ORLEANS", "USMSY"], accent: "#D4A361" },
  { name: "Qingdao", locode: "CNQDG", coords: [120.30, 36.02], region: "Yellow Sea", epithet: "The eastern anchorage", aliases: ["QINGDAO", "CNQDG"], accent: "#D28C61" },
  { name: "Valparaíso", locode: "CLVAP", coords: [-71.66, -33.03], region: "South Pacific", epithet: "The painted Pacific stair", aliases: ["VALPARAISO", "VALPARAÍSO", "CLVAP"], accent: "#C98762" },
];

function normalizeDestination(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9ÅÄÖØÆ]/g, " ").replace(/\s+/g, " ").trim();
}

export function resolveDestination(value?: string) {
  if (!value) return undefined;
  const normalized = normalizeDestination(value);
  if (!normalized || ["UNKNOWN", "FOR ORDERS", "ORDERS", "SEA", "NIL", "NOT AVAILABLE"].includes(normalized)) return undefined;
  return PORT_SANCTUARIES.find((port) => port.aliases.some((alias) => {
    const normalizedAlias = normalizeDestination(alias);
    return normalized === normalizedAlias || normalized.includes(normalizedAlias);
  }));
}
