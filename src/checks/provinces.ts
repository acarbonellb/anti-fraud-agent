/**
 * Spanish postal codes start with the province code (01–52). Province names
 * come from Satella as free strings, so each province accepts its Spanish
 * and co-official names, compared without case, accents or punctuation.
 */
const PROVINCES: Record<string, readonly string[]> = {
  "01": ["Álava", "Araba"],
  "02": ["Albacete"],
  "03": ["Alicante", "Alacant"],
  "04": ["Almería"],
  "05": ["Ávila"],
  "06": ["Badajoz"],
  "07": ["Baleares", "Illes Balears", "Islas Baleares", "Balears"],
  "08": ["Barcelona"],
  "09": ["Burgos"],
  "10": ["Cáceres"],
  "11": ["Cádiz"],
  "12": ["Castellón", "Castelló"],
  "13": ["Ciudad Real"],
  "14": ["Córdoba"],
  "15": ["A Coruña", "La Coruña", "Coruña"],
  "16": ["Cuenca"],
  "17": ["Girona", "Gerona"],
  "18": ["Granada"],
  "19": ["Guadalajara"],
  "20": ["Gipuzkoa", "Guipúzcoa"],
  "21": ["Huelva"],
  "22": ["Huesca"],
  "23": ["Jaén"],
  "24": ["León"],
  "25": ["Lleida", "Lérida"],
  "26": ["La Rioja", "Rioja"],
  "27": ["Lugo"],
  "28": ["Madrid"],
  "29": ["Málaga"],
  "30": ["Murcia"],
  "31": ["Navarra", "Nafarroa"],
  "32": ["Ourense", "Orense"],
  "33": ["Asturias"],
  "34": ["Palencia"],
  "35": ["Las Palmas"],
  "36": ["Pontevedra"],
  "37": ["Salamanca"],
  "38": ["Santa Cruz de Tenerife"],
  "39": ["Cantabria"],
  "40": ["Segovia"],
  "41": ["Sevilla"],
  "42": ["Soria"],
  "43": ["Tarragona"],
  "44": ["Teruel"],
  "45": ["Toledo"],
  "46": ["Valencia", "València"],
  "47": ["Valladolid"],
  "48": ["Bizkaia", "Vizcaya"],
  "49": ["Zamora"],
  "50": ["Zaragoza"],
  "51": ["Ceuta"],
  "52": ["Melilla"],
};

export function foldName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const codeByName = new Map<string, string>(
  Object.entries(PROVINCES).flatMap(([code, names]) =>
    names.map((name) => [foldName(name), code] as const),
  ),
);

/** The province code a name stands for; handles "Araba/Álava" forms. */
export function provinceCode(name: string): string | null {
  for (const part of [name, ...name.split("/")]) {
    const code = codeByName.get(foldName(part));
    if (code !== undefined) return code;
  }
  return null;
}

/** The canonical (Spanish) name of a province code, or null if it doesn't exist. */
export function provinceName(code: string): string | null {
  return PROVINCES[code]?.[0] ?? null;
}
