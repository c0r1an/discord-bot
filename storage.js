import fs from "node:fs/promises";
import path from "node:path";

const FILE = path.join(process.cwd(), "storage.json");

async function readJson() {
  try {
    const txt = await fs.readFile(FILE, "utf8");
    return JSON.parse(txt);
  } catch {
    return { links: [] };
  }
}

async function writeJson(obj) {
  await fs.writeFile(FILE, JSON.stringify(obj, null, 2), "utf8");
}

export async function loadLinks() {
  const db = await readJson();
  return Array.isArray(db.links) ? db.links : [];
}

export async function saveLinks(links) {
  await writeJson({ links });
}