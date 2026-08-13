export type EnvironmentPoint = {
  id: string;
  name: string;
  coords: [number, number];
  observedAt?: string;
  windSpeedKn?: number;
  windDirection?: number;
  waveHeightM?: number;
  waveDirection?: number;
  currentSpeedKmh?: number;
  currentDirection?: number;
  seaSurfaceTempC?: number;
};

export const ENVIRONMENT_SAMPLES: EnvironmentPoint[] = [
  { id: "north-atlantic", name: "North Atlantic", coords: [-35, 42] },
  { id: "labrador", name: "Labrador Sea", coords: [-50, 55] },
  { id: "caribbean", name: "Caribbean", coords: [-68, 18] },
  { id: "south-atlantic", name: "South Atlantic", coords: [-22, -27] },
  { id: "north-pacific", name: "North Pacific", coords: [-155, 37] },
  { id: "eastern-pacific", name: "Eastern Pacific", coords: [-112, 10] },
  { id: "south-pacific", name: "South Pacific", coords: [-135, -28] },
  { id: "coral-sea", name: "Coral Sea", coords: [155, -20] },
  { id: "arabian-sea", name: "Arabian Sea", coords: [64, 15] },
  { id: "bay-of-bengal", name: "Bay of Bengal", coords: [87, 14] },
  { id: "indian-ocean", name: "Indian Ocean", coords: [76, -24] },
  { id: "south-indian", name: "South Indian Ocean", coords: [42, -38] },
  { id: "philippine-sea", name: "Philippine Sea", coords: [137, 18] },
  { id: "east-china-sea", name: "East China Sea", coords: [126, 29] },
  { id: "mediterranean", name: "Mediterranean", coords: [17, 35] },
  { id: "north-sea", name: "North Sea", coords: [3, 56] },
  { id: "norwegian-sea", name: "Norwegian Sea", coords: [5, 66] },
  { id: "barents-sea", name: "Barents Sea", coords: [28, 73] },
  { id: "skagerrak", name: "Skagerrak", coords: [9, 58] },
  { id: "baltic", name: "Baltic Sea", coords: [19, 57] },
  { id: "gulf-finland", name: "Gulf of Finland", coords: [25, 59.6] },
  { id: "bothnia", name: "Bay of Bothnia", coords: [21, 64] },
];

type ApiCurrent = Record<string, number | string | null>;
type ApiResult = { current?: ApiCurrent };

const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;

export async function fetchEnvironment(): Promise<EnvironmentPoint[]> {
  const latitude = ENVIRONMENT_SAMPLES.map((point) => point.coords[1]).join(",");
  const longitude = ENVIRONMENT_SAMPLES.map((point) => point.coords[0]).join(",");
  const weatherUrl = new URL("https://api.open-meteo.com/v1/gfs");
  weatherUrl.searchParams.set("latitude", latitude);
  weatherUrl.searchParams.set("longitude", longitude);
  weatherUrl.searchParams.set("current", "wind_speed_10m,wind_direction_10m");
  weatherUrl.searchParams.set("wind_speed_unit", "kn");

  const marineUrl = new URL("https://marine-api.open-meteo.com/v1/marine");
  marineUrl.searchParams.set("latitude", latitude);
  marineUrl.searchParams.set("longitude", longitude);
  marineUrl.searchParams.set("current", "wave_height,wave_direction,ocean_current_velocity,ocean_current_direction,sea_surface_temperature");
  marineUrl.searchParams.set("cell_selection", "sea");

  const [weatherResponse, marineResponse] = await Promise.all([fetch(weatherUrl), fetch(marineUrl)]);
  if (!weatherResponse.ok || !marineResponse.ok) throw new Error("Environmental data source unavailable");
  const weather = await weatherResponse.json() as ApiResult | ApiResult[];
  const marine = await marineResponse.json() as ApiResult | ApiResult[];
  const weatherRows = Array.isArray(weather) ? weather : [weather];
  const marineRows = Array.isArray(marine) ? marine : [marine];

  return ENVIRONMENT_SAMPLES.map((sample, index) => {
    const atmosphere = weatherRows[index]?.current ?? {};
    const ocean = marineRows[index]?.current ?? {};
    return {
      ...sample,
      observedAt: String(atmosphere.time ?? ocean.time ?? ""),
      windSpeedKn: finite(atmosphere.wind_speed_10m),
      windDirection: finite(atmosphere.wind_direction_10m),
      waveHeightM: finite(ocean.wave_height),
      waveDirection: finite(ocean.wave_direction),
      currentSpeedKmh: finite(ocean.ocean_current_velocity),
      currentDirection: finite(ocean.ocean_current_direction),
      seaSurfaceTempC: finite(ocean.sea_surface_temperature),
    };
  });
}
