import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const S = 20; // tile size; the map is the contribution grid plus one tile of water on each side

const LEAVES = ['#4e9a52', '#5aab5a', '#3f8a55'];
const ROOFS = ['#e76f51', '#f4a261', '#d1495b', '#6c8ebf'];
const TOWERS = [['#dfe6ee', '#f5f8fb'], ['#f0dcc0', '#faf0e2'], ['#cfd8e6', '#eaf0f7']]; // [wall, roof]

// Sprites are drawn around their base point (0,0). Parts without a fill take the fill of the <use>.
const SPRITES = `
<g id="grass" fill="none" stroke="#6aa84f" stroke-width="1.4" stroke-linecap="round"><path d="M-3 0l-1-3.5M0 0v-4.5M3 0l1-3.5"/></g>
<g id="tree"><ellipse rx="6" ry="2" fill="#000" opacity=".15"/><rect x="-1.5" y="-6" width="3" height="6" rx="1" fill="#8b5e3c"/><circle cy="-10" r="6.5"/><circle cx="-2" cy="-12" r="2.5" fill="#fff" opacity=".25"/></g>
<g id="house"><ellipse rx="8" ry="2" fill="#000" opacity=".15"/><rect x="-6" y="-8" width="12" height="8" fill="#fbf0da"/><path d="M-8-7.5 0-15l8 7.5z"/><rect x="-1.5" y="-5" width="3" height="5" fill="#8b5e3c"/><path d="M-5-6h2.5v2.5H-5zM2.5-6H5v2.5H2.5z" fill="#ffd166"/></g>
<g id="boat"><ellipse rx="8" ry="1.5" fill="#fff" opacity=".4"/><path d="M-7-3h14l-2.5 3.5h-9z"/><path d="M0-15v12" stroke="#8b5e3c"/><path d="M1-14v10h6z" fill="#fff"/><path d="M-1-11v7h-4.5z" fill="#fbf0da"/></g>`;

// Command-line arguments, or the action's inputs when GitHub Actions runs this file.
const [user = process.env.INPUT_USERNAME, out = process.env.INPUT_PATH || 'village.svg'] = process.argv.slice(2);
const token = process.env.INPUT_TOKEN || process.env.GITHUB_TOKEN;
if (!user) {
  console.error('Usage: node village.js <github-username> [output.svg]');
  process.exit(1);
}

// The action always has a token, so it uses the API. Local runs without one read the public page instead.
const grid = token ? await fromApi(user, token) : await fromPage(user);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, render(grid));
console.log(`Wrote ${out} from ${token ? 'the GitHub API' : 'the public contributions page'}`);

async function fromApi(user, token) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: `query ($login: String!) {
        user(login: $login) { contributionsCollection { contributionCalendar { weeks { contributionDays { weekday contributionCount } } } } }
      }`,
      variables: { login: user },
    }),
  });
  const { data, errors, message } = await res.json().catch(() => ({}));
  if (!res.ok || errors) throw new Error(`GitHub API: ${errors?.[0].message ?? message ?? res.status}`);
  // The first week can start mid-week, so each day is placed by its weekday.
  return data.user.contributionsCollection.contributionCalendar.weeks.map(({ contributionDays }) => {
    const week = [];
    for (const { weekday, contributionCount } of contributionDays) week[weekday] = contributionCount;
    return week;
  });
}

// Every day on github.com/users/<user>/contributions has a tooltip like
// for="contribution-day-component-<weekday>-<week>" ...>3 contributions on ...
async function fromPage(user) {
  const res = await fetch(`https://github.com/users/${encodeURIComponent(user)}/contributions`);
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for "${user}"`);
  const grid = [];
  const days = (await res.text()).matchAll(/contribution-day-component-(\d+)-(\d+)"[^>]*>(No|[\d,]+) contribution/g);
  for (const [, day, week, n] of days) {
    grid[week] ??= [];
    grid[week][day] = n === 'No' ? 0 : Number(n.replaceAll(',', ''));
  }
  if (!grid.length) throw new Error(`No contributions found for "${user}"`);
  return grid;
}

function render(grid) {
  const weeks = grid.length;
  const width = (weeks + 2) * S;
  const height = 9 * S;
  const count = (w, d) => grid[w]?.[d] ?? 0;
  // Boats go on real days (not the margin) that have water to the left, right, top and bottom.
  const roomForBoat = (w, d) => grid[w]?.[d] === 0 && !count(w - 1, d) && !count(w + 1, d) && !count(w, d - 1) && !count(w, d + 1);

  let land = '';
  let waves = '';
  let things = '';
  for (let d = -1; d <= 7; d++) {
    for (let w = -1; w <= weeks; w++) {
      const n = count(w, d);
      const x = (w + 1) * S;
      const y = (d + 1) * S;
      const r = (k) => rand(w, d, k);
      if (n) {
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([dw, dd]) => (count(w + dw, d) || count(w, d + dd) ? 0 : 7));
        land += tile(x, y, corners);
        things += sprite(n, x + S / 2, y + S * 0.75, r);
      } else if (roomForBoat(w, d) && r(4) < 0.1) {
        things += sprite(0, x + S / 2, y + S * 0.75, r);
      } else if (!count(w, d + 1) && r(0) < 0.12) { // no waves right behind land, where they'd peek over roofs
        waves += `M${x + 5} ${y + 10}q2.5-2.5 5 0t5 0`;
      }
    }
  }

  // The land is drawn three times: a shallow-water outline, the cliff (shifted down), then the grass on top.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><path id="land" d="${land}"/>${SPRITES}</defs>
<rect width="${width}" height="${height}" rx="12" fill="#4cb6ceaa"/>
<path d="${waves}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.2" stroke-linecap="round"/>
<g fill="#bfe8f2" stroke="#bfe8f2" stroke-width="6" stroke-linejoin="round"><use href="#land"/><use href="#land" y="5"/></g>
<use href="#land" y="5" fill="#a8774f"/>
<use href="#land" fill="#a7d676"/>
${things}
</svg>
`;
}

// A land square. Each corner radius is 0 where it touches more land, so neighbouring tiles merge into islands.
function tile(x, y, [tl, tr, br, bl]) {
  const right = x + S;
  const bottom = y + S;
  return [
    `M${x + tl} ${y}H${right - tr}Q${right} ${y} ${right} ${y + tr}`,
    `V${bottom - br}Q${right} ${bottom} ${right - br} ${bottom}`,
    `H${x + bl}Q${x} ${bottom} ${x} ${bottom - bl}`,
    `V${y + tl}Q${x} ${y} ${x + tl} ${y}Z`,
  ].join('');
}

function sprite(n, cx, by, r) {
  const jx = cx + Math.round(r(1) * 4 - 2); // nudge plants and boats off the grid a little
  const jy = by + Math.round(r(2) * 4 - 2);
  if (n === 0) return `<use href="#boat" x="${jx}" y="${jy}" fill="${pick(ROOFS, r(3))}"/>`;
  if (n === 1) return `<use href="#grass" x="${jx}" y="${jy}"/>`;
  if (n === 2) return `<use href="#tree" x="${jx}" y="${jy}" fill="${pick(LEAVES, r(3))}"/>`;
  if (n <= 5) return `<use href="#house" x="${cx}" y="${by}" fill="${pick(ROOFS, r(3))}"/>`;
  return building(n, cx, by, r);
}

// Busier days get taller buildings: 6-7 contributions is 2 floors, 16+ is 5.
function building(n, cx, by, r) {
  const floors = Math.min(5, Math.floor(n / 4) + 1);
  const h = floors * 5 + 2;
  const [wall, roof] = pick(TOWERS, r(3));
  let lit = '';
  let dark = '';
  for (let i = 0; i < floors * 3; i++) {
    const win = `M${(i % 3) * 4 - 5} ${Math.floor(i / 3) * 5 + 2 - h}h2v3h-2z`;
    if (r(4 + i) < 0.6) lit += win;
    else dark += win;
  }
  return `<g transform="translate(${cx} ${by})"><ellipse rx="9" ry="2.5" fill="#000" opacity=".15"/><rect x="-7" y="${-h}" width="14" height="${h}" fill="${wall}"/><rect x="-7" y="${-h - 4}" width="14" height="4" fill="${roof}"/><path d="${lit}" fill="#ffd166"/><path d="${dark}" fill="#8fb3cf"/></g>`;
}

// Deterministic per-tile randomness, so the same graph always gives the same village.
function rand(w, d, k) {
  const s = Math.sin(w * 12.9898 + d * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function pick(list, t) {
  return list[Math.floor(t * list.length)];
}
