// Pulls your channel's videos and playlists from YouTube and writes songs.json for ~/songs.
//
//   ~/songs/all/          every public upload on the channel
//   ~/songs/<playlist>/   one folder per public playlist on the channel
//
// Usage:
//   YT_API_KEY=... YT_CHANNEL_ID=UC... node scripts/fetch-songs.mjs [output-path]
//
// Optional:
//   YT_SKIP_PLAYLISTS=PLxxx,PLyyy   playlist IDs to hide from the site
//   YT_ALL=playlists                make all/ = videos that are in at least one playlist
//                                   (default: every public upload, including ones in no playlist)
//
// Needs Node 18+ (built-in fetch). Output defaults to ./songs.json.

import { readFile, writeFile } from "node:fs/promises";

const KEY = process.env.YT_API_KEY;
const CHANNEL = process.env.YT_CHANNEL_ID;
const SKIP = new Set((process.env.YT_SKIP_PLAYLISTS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const ALL_FROM_PLAYLISTS = process.env.YT_ALL === "playlists";
const OUT = process.argv[2] ?? "songs.json";

if (!KEY || !CHANNEL) {
  console.error("Set YT_API_KEY and YT_CHANNEL_ID environment variables.");
  process.exit(1);
}

async function api(endpoint, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  url.search = new URLSearchParams({ ...params, key: KEY });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube API ${endpoint} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function paged(endpoint, params) {
  const items = [];
  let pageToken = "";
  do {
    const page = await api(endpoint, { ...params, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return items;
}

const songsById = new Map();

// Reads one playlist; returns its public video IDs in playlist order and records the videos.
async function readPlaylist(playlistId) {
  const items = await paged("playlistItems", { part: "snippet,contentDetails,status", playlistId });
  const ids = [];
  for (const it of items) {
    if (it.status?.privacyStatus !== "public") continue;      // private / deleted / unlisted
    const id = it.contentDetails.videoId;
    ids.push(id);
    if (!songsById.has(id)) {
      const t = it.snippet.thumbnails ?? {};
      songsById.set(id, {
        id,
        title: it.snippet.title,
        published: it.contentDetails.videoPublishedAt ?? it.snippet.publishedAt,
        thumbnail: (t.medium ?? t.high ?? t.default)?.url ?? null,
      });
    }
  }
  return ids;
}

// 1. the channel's uploads playlist (every public video)
const channel = await api("channels", { part: "contentDetails,snippet", id: CHANNEL });
if (!channel.items?.length) throw new Error(`Channel ${CHANNEL} not found`);
const uploadsId = channel.items[0].contentDetails.relatedPlaylists.uploads;
const thumbs = channel.items[0].snippet.thumbnails ?? {};
const avatar = (thumbs.high ?? thumbs.medium ?? thumbs.default)?.url ?? null;   // channel profile picture
const uploadIds = await readPlaylist(uploadsId);

// 2. every public playlist on the channel
const playlistMeta = (await paged("playlists", { part: "snippet,status", channelId: CHANNEL }))
  .filter((p) => p.status?.privacyStatus === "public" && !SKIP.has(p.id));

const playlists = [];
for (const p of playlistMeta) {
  const videos = await readPlaylist(p.id);
  if (videos.length) playlists.push({ id: p.id, title: p.snippet.title, videos });
}
playlists.sort((a, b) => a.title.localeCompare(b.title));

// 3. all/
const inPlaylists = new Set(playlists.flatMap((p) => p.videos));
const allIds = ALL_FROM_PLAYLISTS ? [...inPlaylists] : [...new Set([...uploadIds, ...inPlaylists])];
const songs = allIds
  .map((id) => songsById.get(id))
  .sort((a, b) => new Date(b.published) - new Date(a.published));

const json = JSON.stringify({ channel: CHANNEL, avatar, playlists, songs }, null, 2) + "\n";

// Only rewrite when something changed, so the scheduled job doesn't make empty commits.
const previous = await readFile(OUT, "utf8").catch(() => "");
if (previous === json) {
  console.log(`No changes (${songs.length} songs, ${playlists.length} playlists).`);
} else {
  await writeFile(OUT, json);
  console.log(`Wrote ${songs.length} songs in ${playlists.length} playlists to ${OUT}.`);
}
