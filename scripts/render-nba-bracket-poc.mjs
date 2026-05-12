import fs from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

const PAGE_URL = "https://www.nba.com/playoffs/2026";
const CDN = "https://cdn.nba.com";
const OUT_DIR = new URL("../output/", import.meta.url);

const COLORS = {
  canvas: "#f3f4f5",
  surface: "#ffffff",
  text: "#000000",
  divider: "#e7e9ea",
  tbd: "#daddde",
  scarlet: "#c8102e",
  onDark: "#ffffff",
};

const TILE = {
  tileWidth: 128,
  tileHeight: 134,
  hatHeight: 32,
  hatHeightNoBroadcaster: 20,
  hatY: 0,
  hatYNoBroadcaster: 12,
  hatLiveRadius: 3,
  hatLiveY: 9,
  hatLiveX: 6,
  hatDx: 8,
  hatDy: 13,
  hatFontSize: 9,
  teamHeight: 40,
  teamFontSize: 12,
  teamFontWeight: 700,
  teamRankX: 32,
  teamNameX: 43,
  teamTextDy: 24,
  teamLogoSize: 24,
  teamLogoX: 4,
  teamLogoY: 8,
  teamLogoRadius: 9,
  winIndicatorWidth: 4,
  topY: 32,
  botY: 73,
  seriesHeight: 20,
  seriesY: 114,
  seriesFontSize: 10,
  seriesFontWeight: 900,
  seriesDy: 13,
  seriesDx: 4,
};

const POSITIONS = [
  ["er1s1", 897, 0],
  ["er1s4", 897, 148],
  ["er1s3", 897, 296],
  ["er1s2", 897, 444],
  ["er2s1", 737, 64],
  ["er2s2", 737, 360],
  ["er3s1", 611, 210],
  ["wr1s1", 0, 0],
  ["wr1s4", 0, 148],
  ["wr1s3", 0, 296],
  ["wr1s2", 0, 444],
  ["wr2s2", 160, 64],
  ["wr2s1", 160, 360],
  ["wr3s1", 289, 210],
  ["finals", 450, 210],
];

const BRACKET_KEYS = {
  er1s1: ["East", 1, 0],
  er1s2: ["East", 1, 1],
  er1s3: ["East", 1, 2],
  er1s4: ["East", 1, 3],
  er2s1: ["East", 2, 0],
  er2s2: ["East", 2, 1],
  er3s1: ["East", 3, 0],
  wr1s1: ["West", 1, 4],
  wr1s2: ["West", 1, 5],
  wr1s3: ["West", 1, 6],
  wr1s4: ["West", 1, 7],
  wr2s1: ["West", 2, 3],
  wr2s2: ["West", 2, 2],
  wr3s1: ["West", 3, 1],
  finals: ["NBA Finals", 4, 0],
};

const fetchText = async (url) => {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      referer: PAGE_URL,
      accept: "*/*",
    },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}`);
  }
  return response.text();
};

const fetchJson = async (url) => JSON.parse(await fetchText(url));

const esc = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const truncate = (value = "", len = 22) => {
  const str = String(value || "");
  return str.length > len ? `${str.slice(0, len - 3)}...` : str;
};

const dataUri = async (url) => {
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0", referer: PAGE_URL },
  });
  if (!response.ok) throw new Error(`Asset fetch failed ${response.status}: ${url}`);
  const contentType = response.headers.get("content-type") || "image/svg+xml";
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType.split(";")[0]};base64,${buffer.toString("base64")}`;
};

const extractNextData = (html) => {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) throw new Error("Could not find __NEXT_DATA__");
  return JSON.parse(match[1]);
};

const findBracketConfig = (node) => {
  if (!node || typeof node !== "object") return null;
  if (node.type === "tournament_bracket" && node.value) return node.value;
  for (const value of Object.values(node)) {
    const found = findBracketConfig(value);
    if (found) return found;
  }
  return null;
};

const normalizeSeason = (season) => {
  const text = String(season || "");
  const match = text.match(/^(\d{4})/);
  if (!match) throw new Error(`Invalid season: ${season}`);
  return match[1];
};

const indexBracket = (series) => {
  const byKey = new Map();
  for (const row of series) {
    byKey.set(`${row.seriesConference}|${row.roundNumber}|${row.seriesNumber}`, row);
  }
  return Object.fromEntries(
    Object.entries(BRACKET_KEYS).map(([key, parts]) => [
      key,
      byKey.get(parts.join("|")) || {},
    ])
  );
};

const prepSeries = (row) => {
  if (!row || !Object.keys(row).length) return {};
  const copy = { ...row };
  copy.isSet = Boolean(copy.lowSeedId && copy.highSeedId);
  copy.hasTeamConfirmed = Boolean(copy.lowSeedId || copy.highSeedId);
  for (const seed of ["high", "low"]) {
    copy[`${seed}SeedId`] ||= 0;
    copy[`${seed}SeedTricode`] ||= "";
    copy[`${seed}SeedRank`] ||= "";
  }
  copy.topSeedKey = copy.displayTopTeam === copy.highSeedId ? "highSeed" : "lowSeed";
  copy.botSeedKey = copy.displayBottomTeam === copy.highSeedId ? "highSeed" : "lowSeed";
  copy.top = team(copy, copy.topSeedKey, "left");
  copy.bot = team(copy, copy.botSeedKey, "right");
  return copy;
};

const team = (series, prefix, winIndicatorPosition) => {
  const id = series[`${prefix}Id`] || 0;
  return {
    exists: Boolean(id),
    city: series[`${prefix}City`] || "",
    id,
    isSeriesWinner: series.seriesWinner === id,
    name: series[`${prefix}Name`] || "TBD",
    rank: series[`${prefix}Rank`] || "",
    seriesWins: series[`${prefix}SeriesWins`],
    tricode: series[`${prefix}Tricode`] || "",
    winIndicatorPosition,
  };
};

const seriesRecords = (series) => {
  if (!series.isSet) return ["", ""];
  if (series.lowSeedSeriesWins === series.highSeedSeriesWins) {
    return ["SERIES TIED", `${series.lowSeedSeriesWins}-${series.highSeedSeriesWins}`];
  }
  const statusText = series.seriesStatus === 3 ? "WINS" : "LEADS";
  const leader =
    series.lowSeedSeriesWins > series.highSeedSeriesWins ? series.lowSeedTricode : series.highSeedTricode;
  const leaderWins =
    series.lowSeedSeriesWins > series.highSeedSeriesWins
      ? series.lowSeedSeriesWins
      : series.highSeedSeriesWins;
  const trailingWins =
    series.lowSeedSeriesWins > series.highSeedSeriesWins
      ? series.highSeedSeriesWins
      : series.lowSeedSeriesWins;
  return [`${leader} ${statusText}`, `${leaderWins}-${trailingWins}`];
};

const formatNextGame = (series) => {
  if (!series?.nextGameDateTimeUTC) return "";
  const d = new Date(series.nextGameDateTimeUTC);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "America/New_York",
  }).format(d);
};

const broadcasters = (series) =>
  [
    ...(series.nextGameNatlTvBroadcasters || []),
    ...(series.nextGameIntlTvBroadcasters || []),
  ]
    .map((b) => b.broadcasterDisplayName)
    .filter(Boolean)
    .join("/");

const renderNav = () => {
  const labels = [
    [76, "WEST", "First Round"],
    [220, "WEST", "Conf. Semifinals"],
    [366, "WEST", "Conf. Finals"],
    [520, "NBA", "Finals"],
    [674, "EAST", "Conf. Finals"],
    [820, "EAST", "Conf. Semifinals"],
    [964, "EAST", "First Round"],
  ];
  return `<svg width="1041" height="64" viewBox="0 0 1041 64" preserveAspectRatio="xMidYMin slice" font-family="Roboto, Arial, sans-serif">
    <rect fill="${COLORS.canvas}" width="1041" height="64"/>
    ${labels
      .map(
        ([x, conf, round]) => `<g transform="translate(${x},5)" text-anchor="middle" fill="${COLORS.text}">
          <text font-size="10" dy="10">${conf}</text>
          <text font-size="14" font-weight="700" dy="30">${round}</text>
        </g>`
      )
      .join("")}
  </svg>`;
};

const renderTeam = (t, y, logoMap, series) => {
  const dimmed = series.seriesStatus === 3 && !t.isSeriesWinner ? 0.5 : 1;
  if (!t.exists) {
    return `<g transform="translate(0, ${y})">
      <rect height="${TILE.teamHeight}" width="${TILE.tileWidth}" fill="${COLORS.surface}"/>
      <g font-size="${TILE.teamFontSize}" fill="${COLORS.text}">
        <circle transform="translate(${TILE.teamLogoX + 3}, ${TILE.teamLogoY + 3})" cx="${TILE.teamLogoRadius}" cy="${TILE.teamLogoRadius}" r="${TILE.teamLogoRadius}" fill="${COLORS.tbd}"/>
        <text transform="translate(${TILE.teamRankX}, 0)" dy="${TILE.teamTextDy}" font-weight="${TILE.teamFontWeight}">${esc(t.name)}</text>
      </g>
    </g>`;
  }
  const indicatorX =
    t.winIndicatorPosition === "right" ? TILE.tileWidth - TILE.winIndicatorWidth : 0;
  return `<g transform="translate(0, ${y})">
    <rect height="${TILE.teamHeight}" width="${TILE.tileWidth}" fill="${COLORS.surface}"/>
    <g opacity="${dimmed}" font-size="${TILE.teamFontSize}" fill="${COLORS.text}">
      ${
        t.isSeriesWinner
          ? `<rect height="${TILE.teamHeight}" width="${TILE.winIndicatorWidth}" x="${indicatorX}" fill="${COLORS.text}"/>`
          : ""
      }
      <image transform="translate(${TILE.teamLogoX}, ${TILE.teamLogoY})" width="${TILE.teamLogoSize}" height="${TILE.teamLogoSize}" href="${logoMap.get(t.id) || ""}"/>
      <text transform="translate(${TILE.teamRankX}, 0)" dy="${TILE.teamTextDy}">${esc(t.rank)}</text>
      <text transform="translate(${TILE.teamNameX}, 0)" dy="${TILE.teamTextDy}" font-weight="${TILE.teamFontWeight}">${esc(t.name)}</text>
    </g>
  </g>`;
};

const renderTile = (series, logoMap) => {
  const s = prepSeries(series);
  const viewBox = `0 0 ${TILE.tileWidth} ${TILE.tileHeight}`;
  if (!s.hasTeamConfirmed) {
    return `<svg viewBox="${viewBox}" height="${TILE.tileHeight}" width="${TILE.tileWidth}">
      <rect height="${TILE.teamHeight}" width="${TILE.tileWidth}" x="0" y="${TILE.topY}" fill="${COLORS.surface}"/>
      <rect height="${TILE.teamHeight}" width="${TILE.tileWidth}" x="0" y="${TILE.botY}" fill="${COLORS.surface}"/>
    </svg>`;
  }

  const isLive = s.nextGameStatus === 2;
  const isUpcoming = s.seriesStatus === 1 && s.nextGameStatus !== 0;
  const showTuneIn = s.seriesStatus === 2 || isUpcoming;
  const shouldHideBroadcasters = false;
  const nextText = isLive ? "LIVE" : (s.nextGameStatusText || formatNextGame(s)).toUpperCase();
  const broadcaster = truncate(broadcasters(s), 22);
  const [recordTeam, recordText] = seriesRecords(s);

  const tuneIn = !showTuneIn
    ? ""
    : `<g font-size="${TILE.hatFontSize}" transform="translate(0, ${shouldHideBroadcasters ? TILE.hatYNoBroadcaster : TILE.hatY})" fill="${COLORS.onDark}" text-transform="uppercase">
        <rect height="${shouldHideBroadcasters ? TILE.hatHeightNoBroadcaster : TILE.hatHeight}" width="${TILE.tileWidth}" fill="${COLORS.text}"/>
        ${
          isLive
            ? `<circle fill="${COLORS.scarlet}" cx="${TILE.hatDx + TILE.hatLiveX}" cy="${TILE.hatDy - 2 - TILE.hatLiveRadius / 2}" r="${TILE.hatLiveRadius}"/>
               <text dy="${TILE.hatDy}" dx="${TILE.hatDx}" font-weight="700" transform="translate(13, 0)">LIVE</text>`
            : `<text dy="${TILE.hatDy}" dx="${TILE.hatDx}" font-weight="700">${esc(nextText)}</text>`
        }
        <text dy="${2 * TILE.hatDy}" dx="${TILE.hatDx}" text-anchor="start">${esc(shouldHideBroadcasters ? "" : broadcaster)}</text>
      </g>`;

  const record = recordTeam
    ? `<g transform="translate(0, ${TILE.seriesY})">
        <rect height="${TILE.seriesHeight}" width="${TILE.tileWidth}" fill="${COLORS.surface}"/>
        <text font-size="${TILE.seriesFontSize}" dy="${TILE.seriesDy}" dx="${TILE.seriesDx}" fill="${COLORS.text}">
          <tspan font-weight="${TILE.seriesFontWeight}">${esc(recordTeam)} </tspan>${esc(recordText)}
        </text>
      </g>`
    : "";

  return `<svg viewBox="${viewBox}" height="${TILE.tileHeight}" width="${TILE.tileWidth}" font-family="Roboto, Arial, sans-serif">
    ${tuneIn}
    ${renderTeam(s.top, TILE.topY, logoMap, s)}
    ${renderTeam(s.bot, TILE.botY, logoMap, s)}
    ${record}
  </svg>`;
};

const renderMain = ({ bracket, logoMap, finalsLogo, showFinalsLogo }) => `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="1025" height="593" viewBox="0 0 1025 593" preserveAspectRatio="xMidYMin slice" font-family="Roboto, Arial, sans-serif">
  <rect fill="${COLORS.canvas}" width="1025" height="593"/>
  <g stroke="${COLORS.text}" fill="none" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" transform="translate(0,11)">
    <polyline transform="translate(128,61.5)" points="0,0 16,0 16,64 32,64 16,64 16,148, 0,148"/>
    <polyline transform="translate(128,357.5)" points="0,0 16,0 16,64 32,64 16,64 16,148, 0,148"/>
    <polyline transform="translate(865,61.5)" points="32,0 16,0 16,64 0,64 16,64 16,148, 32,148"/>
    <polyline transform="translate(865,357.5)" points="32,0 16,0 16,64 0,64 16,64 16,148, 32,148"/>
    <polyline transform="translate(288,125.5)" points="0,0 64,0 64,114"/>
    <polyline transform="translate(288,421.5)" points="0,0 64,0 64,-108"/>
    <polyline transform="translate(737,125.5)" points="0,0 -64,0 -64,114"/>
    <polyline transform="translate(737,421.5)" points="0,0 -64,0 -64,-108"/>
    <polyline transform="translate(417,271.5)" points="0,0 32,0"/>
    <polyline transform="translate(578,271.5)" points="0,0 32,0"/>
  </g>
  ${showFinalsLogo ? `<image transform="translate(435, 110)" width="160" href="${finalsLogo}"/>` : ""}
  ${POSITIONS
    .map(([key, x, y]) => `<g transform="translate(${x}, ${y})">${renderTile(bracket[key], logoMap)}</g>`)
    .join("")}
</svg>`;

const renderCombined = (mainSvg) => `<svg xmlns="http://www.w3.org/2000/svg" width="1041" height="657" viewBox="0 0 1041 657" preserveAspectRatio="xMidYMin slice">
  <rect width="1041" height="657" fill="${COLORS.canvas}"/>
  <g transform="translate(0,0)">${renderNav()}</g>
  <g transform="translate(8,64)">${mainSvg}</g>
</svg>`;

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const pageHtml = await fetchText(PAGE_URL);
  const nextData = extractNextData(pageHtml);
  const config = findBracketConfig(nextData.props) || {};
  const season = normalizeSeason(config.season || "2025");
  const bracketUrl = `${CDN}/static/json/staticData/brackets/${season}/PlayoffBracket.json`;
  const data = await fetchJson(bracketUrl);
  const rows = data.bracket?.playoffBracketSeries || [];
  const bracket = indexBracket(rows);
  const ids = [...new Set(rows.flatMap((s) => [s.highSeedId, s.lowSeedId]).filter(Boolean))];
  const logoMap = new Map();
  for (const id of ids) {
    const url = `${CDN}/logos/nba/${id}/primary/L/logo.svg`;
    try {
      logoMap.set(id, await dataUri(url));
    } catch {
      logoMap.set(id, "");
    }
  }
  const fallbackLogo = `${CDN}/logos/playoffs/${season}/L/finals.svg`;
  const finalsLogo = await dataUri(config.bracketLogoUrl || config.logoImage || fallbackLogo);
  const mainSvg = renderMain({
    bracket,
    logoMap,
    finalsLogo,
    showFinalsLogo: config.showFinalsLogo !== false,
  });
  const combinedSvg = renderCombined(mainSvg);
  const svgPath = path.join(OUT_DIR.pathname, "bracket.svg");
  const pngPath = path.join(OUT_DIR.pathname, "bracket.png");
  const headersPath = path.join(OUT_DIR.pathname, "_headers");
  await fs.writeFile(svgPath, combinedSvg);
  const png = new Resvg(combinedSvg, {
    fitTo: { mode: "width", value: 2082 },
    font: { loadSystemFonts: true },
  })
    .render()
    .asPng();
  await fs.writeFile(pngPath, png);
  await fs.writeFile(
    headersPath,
    "/bracket.png\n  Cache-Control: no-store\n/bracket.svg\n  Cache-Control: no-store\n"
  );
  console.log(JSON.stringify({ season, bracketUrl, svgPath, pngPath }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
