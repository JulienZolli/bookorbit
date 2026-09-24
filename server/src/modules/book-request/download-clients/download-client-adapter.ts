import { join } from 'node:path';

import { BadRequestException } from '@nestjs/common';
import type { DownloadClientTestResult, DownloadClientType, DownloadDelivery } from '@bookorbit/types';

/** A client row with its credentials already decrypted. Never logged, never returned over HTTP. */
export interface ResolvedClientConfig {
  id: number;
  name: string;
  adapterType: DownloadClientType;
  baseUrl: string;
  username: string | null;
  password: string | null;
  category: string;
  allowPrivateAddress: boolean;
  settings: Record<string, unknown> | null;
}

export interface GrabPayload {
  /** Exactly one delivery payload is set. */
  magnet?: string;
  torrentFile?: Buffer;
  torrentFileName?: string;
  nzbFile?: Buffer;
  nzbFileName?: string;
  /** A source that serves the file itself, resolved by the indexer adapter to one direct URL. */
  fileUrl?: string;
  fileName?: string;
  /**
   * How the client and poll loop identify this download. It is an infohash for a torrent and a
   * stable digest for other deliveries, keeping duplicate-grab protection client-independent.
   */
  clientKey: string;
  /**
   * Passed to the client at add time so the client, not BookOrbit, enforces the seed goal.
   * Unset in phase 2: there is no indexer to take a goal from yet.
   */
  seedRatioGoal?: number;
  seedTimeMinutes?: number;
  /**
   * The one file of a multi-file torrent to download, 0-based in `info.files` order. Every other
   * file stays unwanted. Only ever set when the adapter's `fileSelection` covers this delivery.
   */
  fileIndex?: number;
}

export interface AddResult {
  clientKey: string;
  /**
   * The torrent was added without its file list, stopped once its metadata arrives, and still has
   * `fileIndex` to apply. The poll loop finishes the selection through `selectFile`.
   */
  fileSelectionPending?: boolean;
  /**
   * The client already held this torrent, so it is not ours to take back: a failure after the add
   * must leave it where it was rather than remove somebody else's download.
   */
  adopted?: boolean;
}

/** Which deliveries an adapter can restrict to one file without transferring any other. */
export interface FileSelectionSupport {
  magnet: boolean;
  torrentFile: boolean;
}

export const NO_FILE_SELECTION: FileSelectionSupport = { magnet: false, torrentFile: false };

/**
 * The torrent has no file at the requested index. Its own class because it is the one selection
 * failure that is an answer about the release: anything else is the client being unreachable,
 * and the next poll asks again.
 */
export class FileIndexOutOfRangeException extends BadRequestException {
  constructor(fileIndex: number, fileCount: number) {
    super(`The release names file ${fileIndex}, but the torrent only has ${fileCount} file${fileCount === 1 ? '' : 's'}`);
  }
}

export type DownloadState = 'queued' | 'downloading' | 'completed' | 'failed' | 'unknown';

/**
 * What the client is doing with a torrent it has finished. Read live when an approver asks, not
 * stored: a seed outlives the import by weeks and polling every finished download forever would
 * grow without bound.
 */
export interface SeedInfo {
  /** False once the client has stopped it, whether by reaching a goal, by pause or by error. */
  seeding: boolean;
  ratio: number | null;
  /** The goal the client is enforcing, when it reports one back rather than deferring to global. */
  ratioGoal: number | null;
  seedingTimeSeconds: number | null;
  seedingTimeGoalMinutes: number | null;
  uploadedBytes: number | null;
}

export interface DownloadStatus {
  clientKey: string;
  state: DownloadState;
  /** 0-100. */
  progressPercent: number;
  downloadedBytes: number;
  totalBytes: number | null;
  /**
   * Where the finished content sits. In the client's own filesystem namespace for a client that
   * has one, and a BookOrbit-local staged directory for a staging adapter, which is why the
   * import only opens either after checking it against the root it is allowed to read from.
   */
  contentPath: string | null;
  /** Only meaningful once the bytes are down; the poll loop ignores it. */
  seed?: SeedInfo;
  errorMessage?: string;
  /**
   * The tracker's error, which may be a transient transport failure or an explicit rejection.
   * A failed announce can leave the torrent in a healthy-looking stalled state; the monitor
   * classifies the message before deciding whether the attempt is over.
   */
  trackerError?: string;
}

/**
 * The directory a staging adapter fetched its files into, on a filesystem BookOrbit can read.
 * A cloud client holds the finished torrent itself, so "done" there is not yet importable; this
 * is the local form the import path takes over from.
 */
export interface StagedDownloadResult {
  /** Local directory holding the finished release, inside `stagedDownloadRoot()`. */
  contentPath: string;
}

export interface OwnedDownloadClientItem extends DownloadStatus {
  name: string;
}

export interface OwnedDownloadClientInventory {
  supported: boolean;
  truncated: boolean;
  items: OwnedDownloadClientItem[];
}

export interface DownloadClientAdapter {
  readonly type: DownloadClientType;
  readonly label: string;
  /** What this client can be handed, which is what decides whether a given grab may go to it. */
  readonly delivers: DownloadDelivery;
  /** Checked before anything is added: a grab naming one file must never become the whole pack. */
  readonly fileSelection: FileSelectionSupport;

  add(release: GrabPayload, config: ResolvedClientConfig): Promise<AddResult>;
  /**
   * Finishes a selection `add` left pending: wants `fileIndex` only, unwants every other file and
   * starts the torrent. `pending` while the client has no file list yet; throws
   * `FileIndexOutOfRangeException` when the torrent has no such file.
   */
  selectFile?(clientKey: string, fileIndex: number, config: ResolvedClientConfig): Promise<'pending' | 'selected'>;
  /**
   * Where the client wrote file `fileIndex` of a torrent, in its own filesystem namespace like
   * `contentPath`. Null when the client has no such file, or no longer has the torrent.
   */
  filePath?(clientKey: string, fileIndex: number, config: ResolvedClientConfig): Promise<string | null>;
  /**
   * Batched deliberately: one poll tick is one HTTP call per client however many downloads are
   * in flight. A key the client no longer knows about is simply absent from the result.
   */
  status(clientKeys: string[], config: ResolvedClientConfig): Promise<DownloadStatus[]>;
  listOwned(config: ResolvedClientConfig): Promise<OwnedDownloadClientInventory>;
  remove(clientKey: string, config: ResolvedClientConfig, opts: { deleteFiles: boolean }): Promise<void>;
  /**
   * Stop a local staging transfer without deleting the remote item. Used when a request is being
   * settled by owner deletion or manual fulfillment, where the cloud copy must be preserved.
   */
  cancelStaging?(clientKey: string, config: ResolvedClientConfig): Promise<void>;
  test(config: ResolvedClientConfig): Promise<DownloadClientTestResult>;
  /**
   * Cloud clients that hold the finished files remotely implement this. The monitor calls it when
   * a status reports completion with no content path, then keeps polling: once the bytes are
   * local the adapter reports the staged path and the ordinary import path takes over. A client
   * that already reports a path BookOrbit can read leaves it unimplemented.
   *
   * Keep the shared DOWNLOAD_CLIENT_STAGES_LOCALLY flag in sync with this: the settings form reads
   * that instead of the registry, so a staging adapter missing from it is asked for path mappings.
   */
  stage?(clientKey: string, config: ResolvedClientConfig): Promise<StagedDownloadResult>;
  /**
   * Drop anything cached against this client id. Called whenever a row's URL or credentials
   * change, so a stale session cannot outlive the config it was opened with.
   */
  forget?(clientId: number): void;
}

/**
 * Where staging adapters land fetched cloud files, and the containment root their imports are
 * checked against: a staged path outside this directory is refused rather than opened.
 */
export function stagedDownloadRoot(appDataPath: string): string {
  return join(appDataPath, 'client-downloads');
}

/**
 * Where one client row's staged copy of one release lands. The configured client id is part of the
 * path because two client rows can hold the same infohash: sharing a directory would let their
 * concurrent transfers clobber each other's `.part` files and let one row's cleanup delete the
 * other's staging.
 */
export function stagedClientDir(appDataPath: string, adapterType: DownloadClientType, clientId: number, clientKey: string): string {
  return join(stagedDownloadRoot(appDataPath), adapterType, String(clientId), clientKey);
}

/**
 * The pre-isolation layout, without the client id. Staging still reads it so a release already on
 * disk before the layout change is not fetched again, and cleanup removes it so the stale
 * directory drains. New staging always lands under `stagedClientDir()`.
 */
export function legacyStagedClientDir(appDataPath: string, adapterType: DownloadClientType, clientKey: string): string {
  return join(stagedDownloadRoot(appDataPath), adapterType, clientKey);
}

export const DOWNLOAD_CLIENT_ADAPTERS = Symbol('DOWNLOAD_CLIENT_ADAPTERS');
