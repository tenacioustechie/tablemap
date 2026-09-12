/**
 * Campaign export / import as one zip file (T012, ADR 0017).
 *
 * Archive layout:
 *
 *   campaign.json              the envelope: a format marker, the campaign
 *                              document exactly as stored (`Campaign`), and
 *                              the asset manifest (id, kind, MIME type, path)
 *   assets/0001-map-image.png  one file per asset the document references
 *
 * Files inside the zip get *generated* names — a running index, the asset
 * kind and an extension from the MIME type — never anything derived from ids
 * or user input, so they are legal on every OS (ASCII only, no reserved
 * characters, no case-only collisions). The manifest maps asset ids to those
 * paths; import looks files up by manifest path only and rejects any path
 * that is not a plain file name directly under `assets/`, so a crafted
 * archive cannot point outside itself.
 *
 * Import validates the envelope, runs the document through `migrateCampaign`
 * (older schemas are brought forward, newer ones refused), reads every asset
 * and then writes the campaign and its assets in one transaction. It never
 * overwrites: a campaign id already in storage gets a fresh id (the import is
 * a copy) and clashing asset ids are re-keyed with the document's references
 * rewritten. Every failure is a `CampaignImportError` with a message fit for
 * the UI; nothing is written on failure.
 */
import JSZip from "jszip";
import { nanoid } from "nanoid";
import { blobToBytes } from "./assetCodec";
import { migrateCampaign, type Campaign, type MigrationFailure } from "./campaign";
import type { TableMapDb } from "./db";
import { remapAssetIds, referencedAssetIds } from "./maps";
import {
  isAssetKind,
  isFiniteNumber,
  isNonEmptyString,
  type AssetId,
  type AssetKind,
} from "./model";
import { loadCampaign } from "./persistence";

export const ARCHIVE_FORMAT = "tablemap-campaign";
/** Bump when the *envelope* changes shape; the document has its own `schemaVersion`. */
export const ARCHIVE_FORMAT_VERSION = 1;
export const ARCHIVE_DOCUMENT_PATH = "campaign.json";
export const ARCHIVE_ASSET_DIR = "assets/";
export const ARCHIVE_FILE_SUFFIX = ".tablemap.zip";

/** One asset file in the archive. */
export interface ArchiveAssetEntry {
  id: AssetId;
  kind: AssetKind;
  /** The Blob's MIME type; restored on import. */
  type: string;
  /** Zip path, always `assets/<plain file name>`. */
  path: string;
}

/** What `campaign.json` holds. */
export interface ArchiveEnvelope {
  format: typeof ARCHIVE_FORMAT;
  formatVersion: number;
  /** Epoch milliseconds. */
  exportedAt: number;
  campaign: Campaign;
  assets: ArchiveAssetEntry[];
}

// ---- errors ---------------------------------------------------------------

export type ImportFailure =
  | "not-a-zip"
  | "no-document"
  | "bad-json"
  | "not-a-campaign"
  | "newer-format"
  | "bad-manifest"
  | "missing-asset"
  | "bad-asset"
  | MigrationFailure;

const IMPORT_MESSAGES: Record<ImportFailure, string> = {
  "not-a-zip": "That file is not a zip archive.",
  "no-document":
    "The archive has no campaign.json, so it is not a TableMap campaign export.",
  "bad-json": "The archive's campaign.json is not valid JSON.",
  "not-a-campaign": "The archive's campaign.json is not a TableMap campaign export.",
  "newer-format":
    "The archive was exported by a newer version of TableMap. Update TableMap to import it.",
  "newer-schema":
    "The campaign was saved by a newer version of TableMap. Update TableMap to import it.",
  invalid: "The campaign in the archive is corrupt or incomplete.",
  "bad-manifest": "The archive's asset list is corrupt.",
  "missing-asset": "The archive is missing an image file that its asset list names.",
  "bad-asset": "An image file in the archive is corrupt.",
};

export class CampaignImportError extends Error {
  constructor(
    public readonly reason: ImportFailure,
    detail?: string
  ) {
    super(detail ? `${IMPORT_MESSAGES[reason]} (${detail})` : IMPORT_MESSAGES[reason]);
    this.name = "CampaignImportError";
  }
}

// ---- names ----------------------------------------------------------------

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** A view the `Blob` constructor's typing accepts (JSZip's buffers may be typed as shared). */
function toBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

function extensionForType(type: string): string {
  return EXTENSIONS[type.toLowerCase()] ?? "bin";
}

/** `assets/0001-map-image.png`: index (1-based), kind, extension. */
export function archiveAssetPath(index: number, kind: AssetKind, type: string): string {
  return `${ARCHIVE_ASSET_DIR}${String(index).padStart(4, "0")}-${kind}.${extensionForType(type)}`;
}

/** A plain file name directly under `assets/`: no separators, no leading dot, ASCII only. */
const ASSET_PATH_RE = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Windows refuses these as base names, whatever the extension. */
const RESERVED_BASENAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_NAME_LENGTH = 60;

/**
 * The download name for a campaign's archive: the campaign name reduced to
 * ASCII letters, digits, `-` and `_` (accents stripped, spaces to dashes),
 * `campaign` when nothing is left, plus `.tablemap.zip`.
 */
export function archiveFileName(campaignName: string): string {
  let safe = campaignName
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[^A-Za-z0-9 _-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, MAX_NAME_LENGTH)
    .replace(/[-_]+$/, "");
  if (safe === "") safe = "campaign";
  else if (RESERVED_BASENAMES.test(safe)) safe = `campaign-${safe}`;
  return `${safe}${ARCHIVE_FILE_SUFFIX}`;
}

// ---- export ---------------------------------------------------------------

export interface ExportResult {
  /** The zip, `application/zip`. */
  blob: Blob;
  fileName: string;
  assetCount: number;
  /**
   * Asset ids the document references that were not in storage. The archive
   * was written without them; the document still references them (a missing
   * fog base renders as fully fogged, a missing image as an error).
   */
  missingAssetIds: AssetId[];
}

export interface ExportOptions {
  now?: number;
}

/**
 * Builds the archive for one stored campaign. Throws `CampaignLoadError` if
 * the stored document is unreadable and a plain `Error` if there is no such
 * campaign. Only assets the document references are exported.
 */
export async function exportCampaign(
  db: TableMapDb,
  campaignId: string,
  { now = Date.now() }: ExportOptions = {}
): Promise<ExportResult> {
  const campaign = await loadCampaign(db, campaignId);
  if (!campaign) throw new Error("That campaign no longer exists.");

  const ids = [...referencedAssetIds(campaign.state)];
  const records = await db.assets.bulkGet(ids);

  const zip = new JSZip();
  const manifest: ArchiveAssetEntry[] = [];
  const missingAssetIds: AssetId[] = [];
  for (let i = 0; i < ids.length; i++) {
    const record = records[i];
    if (!record) {
      missingAssetIds.push(ids[i]);
      continue;
    }
    const path = archiveAssetPath(manifest.length + 1, record.kind, record.blob.type);
    manifest.push({ id: record.id, kind: record.kind, type: record.blob.type, path });
    // Images are already compressed; storing them keeps export fast.
    zip.file(path, await blobToBytes(record.blob), { binary: true, compression: "STORE" });
  }

  const envelope: ArchiveEnvelope = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    exportedAt: now,
    campaign,
    assets: manifest,
  };
  zip.file(ARCHIVE_DOCUMENT_PATH, JSON.stringify(envelope, null, 2), {
    compression: "DEFLATE",
  });

  const bytes = await zip.generateAsync({ type: "uint8array" });
  return {
    blob: new Blob([toBlobPart(bytes)], { type: "application/zip" }),
    fileName: archiveFileName(campaign.state.campaignName),
    assetCount: manifest.length,
    missingAssetIds,
  };
}

// ---- import ---------------------------------------------------------------

export interface ImportResult {
  /** The document as stored (ids may differ from the archive's, see below). */
  campaign: Campaign;
  /** True when a campaign with the archive's id already existed, so this one is a copy under a new id. */
  idChanged: boolean;
  /** How many asset ids clashed with assets already in storage and were re-keyed. */
  remappedAssetIds: number;
  assetCount: number;
}

export interface ImportOptions {
  /** Id generator for clashes; injectable for tests. */
  newId?: () => string;
}

export type ArchiveSource = Blob | ArrayBuffer | Uint8Array;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isArchiveAssetEntry(x: unknown): x is ArchiveAssetEntry {
  return (
    isRecord(x) &&
    isNonEmptyString(x.id) &&
    isAssetKind(x.kind) &&
    typeof x.type === "string" &&
    typeof x.path === "string" &&
    ASSET_PATH_RE.test(x.path)
  );
}

/** The envelope minus the document, which `migrateCampaign` validates. */
interface ParsedEnvelope {
  campaign: unknown;
  assets: ArchiveAssetEntry[];
}

function parseEnvelope(raw: unknown): ParsedEnvelope {
  if (
    !isRecord(raw) ||
    raw.format !== ARCHIVE_FORMAT ||
    !isFiniteNumber(raw.formatVersion) ||
    raw.formatVersion < 1
  ) {
    throw new CampaignImportError("not-a-campaign");
  }
  if (raw.formatVersion > ARCHIVE_FORMAT_VERSION) {
    throw new CampaignImportError("newer-format");
  }
  if (!Array.isArray(raw.assets) || !raw.assets.every(isArchiveAssetEntry)) {
    throw new CampaignImportError("bad-manifest");
  }
  const assets = raw.assets as ArchiveAssetEntry[];
  const ids = new Set(assets.map((a) => a.id));
  const paths = new Set(assets.map((a) => a.path));
  if (ids.size !== assets.length || paths.size !== assets.length) {
    throw new CampaignImportError("bad-manifest", "duplicate entries");
  }
  return { campaign: raw.campaign, assets };
}

async function sourceBytes(source: ArchiveSource): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return blobToBytes(source);
}

interface ReadAsset {
  id: AssetId;
  kind: AssetKind;
  blob: Blob;
}

/**
 * Imports an archive produced by `exportCampaign` (any format version up to
 * this build's, any schema version up to this build's). Resolves to the
 * stored campaign; rejects with `CampaignImportError` and writes nothing when
 * the archive is unusable.
 */
export async function importCampaign(
  db: TableMapDb,
  source: ArchiveSource,
  { newId = nanoid }: ImportOptions = {}
): Promise<ImportResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await sourceBytes(source), { checkCRC32: true });
  } catch {
    throw new CampaignImportError("not-a-zip");
  }

  const documentFile = zip.file(ARCHIVE_DOCUMENT_PATH);
  if (!documentFile) throw new CampaignImportError("no-document");
  let raw: unknown;
  try {
    raw = JSON.parse(await documentFile.async("string"));
  } catch {
    throw new CampaignImportError("bad-json");
  }

  const envelope = parseEnvelope(raw);
  const migrated = migrateCampaign(envelope.campaign);
  if (!migrated.ok) throw new CampaignImportError(migrated.reason);
  const doc = migrated.campaign;

  const assets: ReadAsset[] = [];
  for (const entry of envelope.assets) {
    const file = zip.file(entry.path);
    if (!file || file.dir) throw new CampaignImportError("missing-asset", entry.path);
    let bytes: Uint8Array;
    try {
      bytes = await file.async("uint8array");
    } catch {
      throw new CampaignImportError("bad-asset", entry.path);
    }
    assets.push({
      id: entry.id,
      kind: entry.kind,
      blob: new Blob([toBlobPart(bytes)], { type: entry.type }),
    });
  }

  // Everything is in memory; one transaction makes the import all-or-nothing.
  return db.transaction("rw", [db.campaigns, db.assets], async () => {
    const idChanged = (await db.campaigns.get(doc.id)) !== undefined;
    const id = idChanged ? newId() : doc.id;

    const existing = await db.assets.bulkGet(assets.map((a) => a.id));
    const mapping = new Map<AssetId, AssetId>();
    existing.forEach((record, i) => {
      if (record) mapping.set(assets[i].id, newId());
    });

    const campaign: Campaign = {
      ...doc,
      id,
      state: mapping.size > 0 ? remapAssetIds(doc.state, mapping) : doc.state,
    };
    await db.campaigns.add(campaign);
    await db.assets.bulkAdd(
      assets.map((a) => ({
        id: mapping.get(a.id) ?? a.id,
        campaignId: id,
        kind: a.kind,
        blob: a.blob,
      }))
    );
    return { campaign, idChanged, remappedAssetIds: mapping.size, assetCount: assets.length };
  });
}
