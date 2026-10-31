import { Inject, Injectable } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config';
import { Db, Queryable } from '../db/db.service';
import { DEFAULT_CANCELLATION } from '../engine/rules';
import type { CancellationPolicy } from '../engine/types';

/** The money and invoice settings a super admin can change without a deploy. */
export interface PlatformSettings {
  advancePercent: number;
  commissionPercent: number;
  cashDuesLimitPaise: number;
  cancellation: CancellationPolicy;
  platform: { name: string; address: string | null; gstin: string | null };
}

/**
 * How long a server may keep serving the settings it last read. Several API servers each hold their
 * own copy, so a change takes at most this long to reach all of them. Bookings are unaffected either
 * way: every booking stores its own price, commission and cancellation policy when it is made.
 */
export const SETTINGS_TTL_MS = 30_000;

const SELECT = `advance_percent AS "advancePercent", commission_percent AS "commissionPercent",
  cash_dues_limit_paise AS "cashDuesLimitPaise", cancellation,
  platform_name AS "name", platform_address AS "address", platform_gstin AS "gstin"`;

interface Row {
  advancePercent: number;
  commissionPercent: number;
  cashDuesLimitPaise: number;
  cancellation: CancellationPolicy;
  name: string;
  address: string | null;
  gstin: string | null;
}

/**
 * Reads `platform_settings` (one row) behind a short cache. Falls back to the environment only when
 * the row is missing, so a database that has not been migrated yet still starts.
 */
@Injectable()
export class SettingsService {
  private cached?: PlatformSettings;
  private readAt = 0;
  /** One in-flight read shared by every caller, so a cold cache cannot start a thundering herd. */
  private reading?: Promise<PlatformSettings>;
  /** Bumped by every save, so a read that started before it cannot repopulate the stale value. */
  private generation = 0;

  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private fromEnv(): PlatformSettings {
    return {
      advancePercent: this.config.advancePercent,
      commissionPercent: this.config.commissionPercent,
      cashDuesLimitPaise: this.config.cashDuesLimitPaise,
      cancellation: DEFAULT_CANCELLATION,
      platform: this.config.platform,
    };
  }

  /** The current settings, from cache when it is fresh. */
  async get(now = Date.now()): Promise<PlatformSettings> {
    if (this.cached && now - this.readAt < SETTINGS_TTL_MS) return this.cached;
    this.reading ??= this.read().finally(() => {
      this.reading = undefined;
    });
    return this.reading;
  }

  private async read(): Promise<PlatformSettings> {
    // A save can land while this read is in flight. Remember which generation it belongs to, so a
    // read that started before the save does not put the old values back with a fresh timestamp —
    // that would serve the settings the admin just replaced for another full TTL.
    const generation = this.generation;
    const row = await this.db.one<Row>(this.db, `SELECT ${SELECT} FROM platform_settings WHERE id = 1`);
    const settings: PlatformSettings = row
      ? {
          advancePercent: row.advancePercent,
          commissionPercent: row.commissionPercent,
          cashDuesLimitPaise: row.cashDuesLimitPaise,
          cancellation: row.cancellation,
          platform: { name: row.name, address: row.address, gstin: row.gstin },
        }
      : this.fromEnv();
    if (generation === this.generation) {
      this.cached = settings;
      this.readAt = Date.now();
    }
    return settings;
  }

  /**
   * Reads inside someone else's transaction, uncached. With `lock`, holds the row until that
   * transaction ends, so two admins saving at once cannot both read the same "before" and have one
   * of the changes silently lost.
   */
  async fresh(q: Queryable, lock = false): Promise<PlatformSettings | undefined> {
    const row = await this.db.one<Row>(q, `SELECT ${SELECT} FROM platform_settings WHERE id = 1${lock ? ' FOR UPDATE' : ''}`);
    return row && {
      advancePercent: row.advancePercent,
      commissionPercent: row.commissionPercent,
      cashDuesLimitPaise: row.cashDuesLimitPaise,
      cancellation: row.cancellation,
      platform: { name: row.name, address: row.address, gstin: row.gstin },
    };
  }

  /** Drops this server's copy after a save, so the admin sees the new value straight away. */
  invalidate() {
    this.generation++;
    this.cached = undefined;
    this.readAt = 0;
  }
}
